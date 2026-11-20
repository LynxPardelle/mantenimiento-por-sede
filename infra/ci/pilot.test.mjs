import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCiTemplate } from './template.mjs';

const template = () => buildCiTemplate({ account: '123456789012', providerArn: 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com', hostedZoneId: 'Z123ABC', subjectPrefix: 'repo:LynxPardelle@74871143/mantenimiento-por-sede@1461766091' });

test('pilot observations have a private encrypted versioned bucket with bounded report retention', () => {
  const bucket = template().Resources.PilotBucket;
  assert.equal(bucket.DeletionPolicy, 'Retain');
  assert.equal(bucket.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.ok(Object.values(bucket.Properties.PublicAccessBlockConfiguration).every(Boolean));
  assert.equal(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
  const rules = bucket.Properties.LifecycleConfiguration.Rules;
  assert.equal(rules.length, 3);
  assert.ok(rules.every(rule => rule.Prefix.endsWith('/reports/')));
});

test('a separate OIDC observer can query only business tables and cannot change data or cohort enrollment', () => {
  const t = template();
  for (const env of ['Development', 'Testing', 'Production']) {
    const role = t.Resources[env + 'PilotRole'].Properties;
    const trust = role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;
    assert.equal(trust['token.actions.githubusercontent.com:sub'], `repo:LynxPardelle@74871143/mantenimiento-por-sede@1461766091:environment:${env.toLowerCase()}`);
    const statements = role.Policies[0].PolicyDocument.Statement;
    const metadata = statements.find(s => s.Sid === 'DiscoverOwnStackOutputs');
    assert.deepEqual(metadata.Action, ['cloudformation:DescribeStacks', 'cloudformation:ListStackResources']);
    assert.equal(metadata.Resource.length, 5);
    assert.ok(metadata.Resource.every(arn => arn.includes(`:stack/sedepulso-${env.toLowerCase()}-`)));
    const query = statements.find(s => s.Sid === 'ReadEnrolledSiteData');
    assert.deepEqual(query.Action, ['dynamodb:Query']);
    assert.equal(query.Resource.length, 2);
    assert.ok(query.Resource.every(arn => /-(assets|inspections)-\*/.test(arn)));
    assert.ok(!JSON.stringify(query).includes('platform'));
    assert.ok(!JSON.stringify(statements).includes('dynamodb:Scan'));
    assert.equal(statements.find(s => s.Sid === 'ObserveAlarms').Resource, `arn:aws:cloudwatch:us-east-1:123456789012:alarm:sedepulso-${env.toLowerCase()}-*`);
    const writes = statements.filter(s => [].concat(s.Action).includes('s3:PutObject'));
    assert.equal(writes.length, 1);
    assert.match(writes[0].Resource, /\/reports\/\*$/);
    assert.ok(!JSON.stringify(statements).includes('s3:DeleteObject'));
    const actions = statements.flatMap(s => [].concat(s.Action));
    assert.ok(!actions.some(a => /dynamodb:(Put|Update|Delete)|cognito|cloudformation:(Create|Execute)/.test(a)));
    const exporter = statements.find(s => s.Sid === 'ReadApplicationEnrollments');
    assert.deepEqual(exporter.Action, ['lambda:InvokeFunction']);
    assert.equal(exporter.Resource, `arn:aws:lambda:us-east-1:123456789012:function:sedepulso-${env.toLowerCase()}-pilot-PilotExportFunction-*`);
    assert.ok(!JSON.stringify(statements).includes('pilot-PilotFunction-'));
  }
});

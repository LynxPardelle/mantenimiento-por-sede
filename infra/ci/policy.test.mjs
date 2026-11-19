import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCiTemplate } from './template.mjs';

const template = buildCiTemplate({ account: '123456789012', providerArn: 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com', hostedZoneId: 'Z123456' });
const cfnStatements = (id) => template.Resources[id + 'CloudFormationRole'].Properties.ManagedPolicyArns.flatMap(({ Ref }) => template.Resources[Ref].Properties.PolicyDocument.Statement);

test('HTTP API stage creation receives only its demonstrated literal tagging permission', () => {
  for (const environment of ['development', 'testing', 'production']) {
    const id = environment[0].toUpperCase() + environment.slice(1);
    const stagePolicy = template.Resources[id + 'ApiStageTaggingPolicy'];
    assert.ok(stagePolicy, 'The HTTP API V2 CreateStage permission is required by the live provider');
    assert.deepEqual(stagePolicy.Properties.PolicyDocument.Statement[0].Action, ['apigateway:TagResource']);
    assert.deepEqual(stagePolicy.Properties.PolicyDocument.Statement[0].Resource, ['arn:aws:apigateway:us-east-1::/apis/*/stages', 'arn:aws:apigateway:us-east-1::/apis/*/stages/*']);
    assert.deepEqual(stagePolicy.Metadata['cfn-lint'].config.ignore_checks, ['W3037']);
    assert.ok(template.Resources[id + 'CloudFormationRole'].Properties.ManagedPolicyArns.some(({ Ref }) => Ref === id + 'ApiStageTaggingPolicy'));
  }
  assert.ok(!template.Metadata, 'The lint exception must never be global');
});

test('WAF Cognito permissions use discovered exact pool ARNs and fail closed before bootstrap', () => {
  assert.ok(!cfnStatements('Testing').some(({ Sid }) => Sid === 'OwnPoolWafAssociation'));
  const arn = 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_Dev123';
  const scoped = buildCiTemplate({ account: '123456789012', providerArn: 'provider', hostedZoneId: 'Z123456', userPoolArns: { development: arn } });
  const statements = scoped.Resources.DevelopmentCloudFormationRole.Properties.ManagedPolicyArns.flatMap(({ Ref }) => scoped.Resources[Ref].Properties.PolicyDocument.Statement);
  const permission = statements.find(({ Sid }) => Sid === 'OwnPoolWafAssociation');
  assert.equal(permission.Resource, arn);
  assert.equal(permission.Condition, undefined);
  assert.deepEqual(permission.Action, ['cognito-idp:AssociateWebACL', 'cognito-idp:DisassociateWebACL', 'cognito-idp:GetWebACLForResource']);
  assert.throws(() => buildCiTemplate({ account: '123456789012', providerArn: 'provider', hostedZoneId: 'Z123456', userPoolArns: { development: arn.replace('123456789012', '999999999999') } }), /ARN/);
  assert.throws(() => buildCiTemplate({ account: '123456789012', providerArn: 'provider', hostedZoneId: 'Z123456', userPoolArns: { development: arn, testing: arn } }), /propio UserPool/);
});
test('OIDC trust is exact for repository, environment and STS audience', () => {
  for (const environment of ['development', 'testing', 'production']) {
    const id = environment[0].toUpperCase() + environment.slice(1);
    const trust = template.Resources[id + 'GitHubRole'].Properties.AssumeRolePolicyDocument.Statement;
    assert.equal(trust.length, 1);
    assert.deepEqual(trust[0].Condition.StringEquals, {
      'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      'token.actions.githubusercontent.com:sub': `repo:LynxPardelle/mantenimiento-por-sede:environment:${environment}`,
    });
  }
});
test('immutable subject includes repository and owner identifiers without weakening trust', () => {
  const prefix = 'repo:LynxPardelle@74871143/mantenimiento-por-sede@1461766091';
  const immutable = buildCiTemplate({ account: '123456789012', providerArn: 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com', hostedZoneId: 'Z123456', subjectPrefix: prefix });
  assert.equal(immutable.Resources.ProductionGitHubRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:sub'], prefix + ':environment:production');
  assert.throws(() => buildCiTemplate({ account: '123456789012', providerArn: 'provider', hostedZoneId: 'Z123456', subjectPrefix: 'repo:another/repo' }), /subject OIDC/);
});
test('deployment cannot create unbounded runtime roles or edit the CI roles', () => {
  for (const environment of ['development', 'testing', 'production']) {
    const id = environment[0].toUpperCase() + environment.slice(1);
    const statements = cfnStatements(id);
    const create = statements.find(({ Sid }) => Sid === 'CreateBoundedRuntimeRoles');
    assert.equal(create.Condition.StringEquals['iam:PermissionsBoundary'], `arn:aws:iam::123456789012:policy/sedepulso-${environment}-runtime-boundary`);
    assert.equal(create.Resource, `arn:aws:iam::123456789012:role/sedepulso-${environment}-*`);
    assert.ok(!statements.some(({ Action }) => [Action].flat().includes('iam:CreatePolicy')));
    const boundary = template.Resources[id + 'RuntimeBoundary'].Properties.PolicyDocument;
    assert.ok(boundary.Statement.every(({ Action }) => [Action].flat().every((action) => !action.startsWith('iam:') && action !== '*')));
  }
});
test('OIDC deploy is restricted to own stacks, role and artifact prefix', () => {
  for (const environment of ['development', 'testing', 'production']) {
    const id = environment[0].toUpperCase() + environment.slice(1);
    const statements = template.Resources[id + 'GitHubRole'].Properties.Policies[0].PolicyDocument.Statement;
    const create = statements.find(({ Sid }) => Sid === 'CreateOwnChangeSets');
    assert.equal(create.Resource.length, 4);
    assert.ok(create.Resource.every((arn) => arn.includes(`:stack/sedepulso-${environment}-`)));
    const pass = statements.find(({ Sid }) => Sid === 'PassOwnCloudFormationRole');
    assert.equal(pass.Resource, `arn:aws:iam::123456789012:role/sedepulso-ci-${environment}-cloudformation`);
    const artifacts = statements.find(({ Sid }) => Sid === 'EnvironmentArtifacts');
    assert.ok(artifacts.Resource.endsWith(`/${environment}/*`));
  }
});
test('shared WAF only redirects GET signup pages of the three product hosts', () => {
  const acl = template.Resources.SignupWebAcl.Properties;
  assert.deepEqual(acl.DefaultAction, { Allow: {} });
  assert.equal(acl.Scope, 'REGIONAL');
  assert.equal(acl.Rules.length, 3);
  for (const environment of ['development', 'testing', 'production']) {
    const rule = acl.Rules.find(({ Name }) => Name === 'signup-' + environment);
    const conditions = rule.Statement.AndStatement.Statements.map(({ ByteMatchStatement }) => ByteMatchStatement);
    const matches = (method, path, host) => conditions.every((condition) => {
      const value = condition.FieldToMatch.Method ? method : condition.FieldToMatch.UriPath ? path : host.toLowerCase();
      return condition.PositionalConstraint === 'EXACTLY' && value === condition.SearchString;
    });
    const host = `sedepulso-${environment}-123456789012.auth.us-east-1.amazoncognito.com`;
    assert.equal(matches('GET', '/signup', host), true);
    for (const path of ['/', '/login', '/oauth2/token', '/forgotPassword']) assert.equal(matches('GET', path, host), false);
    assert.equal(matches('POST', '/signup', host), false);
    assert.equal(matches('GET', '/signup', 'unrelated.auth.us-east-1.amazoncognito.com'), false);
    assert.equal(rule.Action.Block.CustomResponse.ResponseCode, 302);
    assert.equal(rule.Action.Block.CustomResponse.ResponseHeaders[0].Value, `https://sedepulso${environment === 'production' ? '' : '-' + environment}.lynxpardelle.com/registro`);
    assert.equal(rule.VisibilityConfig.SampledRequestsEnabled, false);
  }
});

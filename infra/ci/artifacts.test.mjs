import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureArtifactBucket } from './artifacts.mjs';

const options = { account: '123456789012', region: 'us-east-1' };
const invoke = (aws) => ensureArtifactBucket(aws, options);
const fakeS3 = ({ exists = true, error, versioning = 'Enabled', publicBlock = true } = {}) => {
  const calls = [];
  const state = { exists, versioning, publicBlock };
  const aws = (args) => {
    calls.push(args);
    const operation = args[1];
    if (operation === 'head-bucket') {
      if (error) throw new Error(error);
      if (!state.exists) throw new Error('An error occurred (404) when calling the HeadBucket operation: Not Found');
    } else if (operation === 'create-bucket') state.exists = true;
    else if (operation === 'put-public-access-block') state.publicBlock = true;
    else if (operation === 'put-bucket-versioning') state.versioning = 'Enabled';
    else if (operation === 'get-public-access-block') return { PublicAccessBlockConfiguration: Object.fromEntries(['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'].map((key) => [key, state.publicBlock])) };
    else if (operation === 'get-bucket-versioning') return { Status: state.versioning };
    else if (operation === 'get-bucket-location') return { LocationConstraint: null };
    return {};
  };
  return { aws, calls, state };
};

test('first bootstrap creates a private versioned artifact bucket before deploying the large CI template', () => {
  const s3 = fakeS3({ exists: false, versioning: null, publicBlock: false });
  const result = invoke(s3.aws);
  assert.equal(result.bucket, 'sedepulso-artifacts-123456789012-us-east-1');
  assert.equal(s3.state.exists, true);
  assert.equal(s3.state.publicBlock, true);
  assert.equal(s3.state.versioning, 'Enabled');
  assert.ok(s3.calls.some((args) => args[1] === 'create-bucket'));
});

test('existing artifact bucket is verified without changing its settings', () => {
  const s3 = fakeS3();
  invoke(s3.aws);
  assert.ok(s3.calls.every((args) => ['head-bucket', 'get-bucket-location', 'get-public-access-block', 'get-bucket-versioning'].includes(args[1])));
  assert.ok(s3.calls.every((args) => args.includes('--expected-bucket-owner') && args.includes(options.account)));
});

test('a denied or failed head request never creates or mutates a bucket', () => {
  for (const error of ['An error occurred (403) when calling the HeadBucket operation: Forbidden', 'AWS connection timed out', 'An error occurred (500): InternalError']) {
    const s3 = fakeS3({ error });
    assert.throws(() => invoke(s3.aws), (caught) => caught.message === error);
    assert.equal(s3.calls.length, 1);
  }
});

test('an existing bucket without privacy or versioning is rejected rather than reconfigured', () => {
  for (const config of [{ publicBlock: false }, { versioning: 'Suspended' }]) {
    const s3 = fakeS3(config);
    assert.throws(() => invoke(s3.aws), /privado y con versionado/);
    assert.ok(s3.calls.every((args) => !/^(create|put|delete)-/.test(args[1])));
  }
});

test('template-only exits before artifact creation and artifact creation precedes CloudFormation deploy', () => {
  const script = readFileSync(new URL('../tools/configure-ci.mjs', import.meta.url), 'utf8');
  const prepare = script.indexOf('ensureArtifactBucket(aws,');
  assert.ok(prepare > script.indexOf('process.exit(0)'), 'template-only must exit before any bucket preparation');
  assert.ok(prepare < script.indexOf("aws(['cloudformation', 'deploy'"), 'artifact bucket must exist before CFN uploads the template');
});

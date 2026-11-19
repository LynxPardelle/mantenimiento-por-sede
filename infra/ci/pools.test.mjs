import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverUserPools } from './pools.mjs';

const account = '123456789012';
const arn = `arn:aws:cognito-idp:us-east-1:${account}:userpool/us-east-1_Dev123`;
const fakeAws = (tags = { Product: 'sedepulso', Environment: 'development' }) => (args) => {
  if (args[0] === 'cloudformation') {
    if (args.includes('sedepulso-development-platform')) return { StackResourceDetail: { PhysicalResourceId: 'us-east-1_Dev123' } };
    throw new Error('Stack does not exist');
  }
  return { UserPool: { Arn: arn, UserPoolTags: tags } };
};

test('bootstrap discovers only the expected tagged stack pool; absent environments have no WAF permission', () => {
  assert.deepEqual(discoverUserPools(fakeAws(), { account }), { development: arn });
});

test('bootstrap refuses an existing pool from a different product or environment', () => {
  for (const tags of [{ Product: 'other', Environment: 'development' }, { Product: 'sedepulso', Environment: 'production' }, {}]) {
    assert.throws(() => discoverUserPools(fakeAws(tags), { account }), /no tiene el ARN y etiquetas/);
  }
});

test('bootstrap propagates denied discovery instead of replacing scope with a wildcard', () => {
  assert.throws(() => discoverUserPools(() => { throw new Error('AccessDenied'); }, { account }), /AccessDenied/);
});

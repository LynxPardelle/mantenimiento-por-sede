import assert from 'node:assert/strict';
import test from 'node:test';

async function implementation() {
  try { return await import('../functions/onboarding/dynamodb.mjs'); }
  catch { assert.fail('The onboarding repository must be implemented.'); }
}

test('onboarding reads the membership consistently from its owning access table', async () => {
  const { createOnboardingRepository } = await implementation();
  const repository = createOnboardingRepository({ tableName: 'access-table', client: { send: async (command) => {
    assert.equal(command.constructor.name, 'GetCommand');
    assert.deepEqual(command.input, { TableName: 'access-table', Key: { pk: 'USER#verified-subject', sk: 'MEMBERSHIP' }, ConsistentRead: true });
    return { Item: { orgId: 'existing-org' } };
  } } });
  assert.equal((await repository.getMembership('verified-subject')).orgId, 'existing-org');
});

test('membership and organization are persisted atomically and cannot overwrite existing records', async () => {
  const { createOnboardingRepository } = await implementation();
  const membership = { pk: 'USER#sub', sk: 'MEMBERSHIP', orgId: 'org_123', sites: [] };
  const organization = { pk: 'ORG#org_123', sk: 'META', ownerSub: 'sub', plan: 'pilot' };
  const repository = createOnboardingRepository({ tableName: 'access-table', client: { send: async (command) => {
    assert.equal(command.constructor.name, 'TransactWriteCommand');
    assert.deepEqual(command.input.TransactItems, [membership, organization].map((Item) => ({ Put: { TableName: 'access-table', Item, ConditionExpression: 'attribute_not_exists(pk)' } })));
    return {};
  } } });
  await repository.createWorkspace({ membership, organization });
});

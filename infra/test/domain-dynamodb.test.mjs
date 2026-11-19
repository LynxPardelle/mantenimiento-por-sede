import assert from 'node:assert/strict';
import { test } from 'node:test';

async function repositories(send) {
  let module;
  try { module = await import('../functions/domain/dynamodb.mjs'); }
  catch { assert.fail('DynamoDB repositories are not implemented'); }
  return module.createDynamoRepositories({ client: { send }, tables: { access: 'access-table', assets: 'assets-table', inspections: 'inspections-table' } });
}

const scope = { orgId: 'org-a', siteId: 'north' };
test('membership lookup uses verified subject and consistent reads', async () => {
  const repos = await repositories(async (command) => {
    assert.equal(command.constructor.name, 'GetCommand');
    assert.deepEqual(command.input, { TableName: 'access-table', Key: { pk: 'USER#subject', sk: 'MEMBERSHIP' }, ConsistentRead: true });
    return { Item: { orgId: 'org-a', sites: [] } };
  });
  assert.equal((await repos.access.getMembership('subject')).orgId, 'org-a');
});

test('asset creation atomically persists entity and scoped idempotency record', async () => {
  const item = { id: 'asset-id', name: 'Fridge', type: 'cooling', status: 'operational' };
  const repos = await repositories(async (command) => {
    assert.equal(command.constructor.name, 'TransactWriteCommand');
    assert.equal(command.input.TransactItems.length, 2);
    const [operation, asset] = command.input.TransactItems.map((entry) => entry.Put);
    assert.equal(operation.TableName, 'assets-table');
    assert.equal(operation.Item.pk, 'ORG#org-a#SITE#north');
    assert.match(operation.Item.sk, /^IDEMPOTENCY#[a-f0-9]{64}$/);
    assert.deepEqual(operation.Item.response, item);
    assert.equal(asset.Item.sk, 'ASSET#asset-id');
    assert.equal(asset.ConditionExpression, 'attribute_not_exists(pk)');
    return {};
  });
  assert.deepEqual(await repos.assets.createAsset({ scope, actor: 'subject', operation: 'createAsset', key: 'one', fingerprint: 'hash', item }), item);
});

test('transaction retry returns persisted response and rejects changed content', async () => {
  const item = { id: 'original-id', name: 'Original' };
  const repos = await repositories(async (command) => {
    if (command.constructor.name === 'TransactWriteCommand') throw Object.assign(new Error('condition'), { name: 'TransactionCanceledException' });
    assert.equal(command.input.ConsistentRead, true);
    return { Item: { fingerprint: 'original-hash', response: item } };
  });
  const args = { scope, actor: 'subject', operation: 'createAsset', key: 'one', fingerprint: 'original-hash', item: { id: 'new-id' } };
  assert.deepEqual(await repos.assets.createAsset(args), item);
  await assert.rejects(repos.assets.createAsset({ ...args, fingerprint: 'different' }), (error) => error.statusCode === 409);
});

test('concurrent transaction waits for a winner whose record is not yet visible', async () => {
  const item = { id: 'winner', name: 'Original' };
  let transactions = 0;
  let reads = 0;
  const repos = await repositories(async (command) => {
    if (command.constructor.name === 'TransactWriteCommand') {
      transactions++;
      throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'TransactionConflict' }] });
    }
    reads++;
    return reads < 2 ? {} : { Item: { fingerprint: 'hash', response: item } };
  });
  assert.deepEqual(await repos.assets.createAsset({ scope, actor: 'subject', operation: 'createAsset', key: 'race', fingerprint: 'hash', item: { id: 'loser' } }), item);
  assert.equal(transactions, 2);
  assert.equal(reads, 2);
});

test('transaction validation errors are not retried or reported as conflicts', async () => {
  let transactions = 0;
  const repos = await repositories(async (command) => {
    if (command.constructor.name === 'TransactWriteCommand') {
      transactions++;
      throw Object.assign(new Error('invalid operation'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ValidationError' }] });
    }
    return {};
  });
  await assert.rejects(repos.assets.createAsset({ scope, actor: 'subject', operation: 'createAsset', key: 'invalid', fingerprint: 'hash', item: { id: 'one' } }), /invalid operation/);
  assert.equal(transactions, 1);
});

test('completion condition removes pending index attributes atomically', async () => {
  const completion = { result: 'ok', note: '', completedBy: 'subject', completedAt: '2026-11-19T18:00:00Z' };
  const repos = await repositories(async (command) => {
    assert.equal(command.constructor.name, 'UpdateCommand');
    assert.equal(command.input.ConditionExpression, '#status = :pending');
    assert.match(command.input.UpdateExpression, /REMOVE pendingSiteKey, pendingDueKey/);
    assert.deepEqual(command.input.Key, { pk: 'ORG#org-a#SITE#north#ASSET#asset-id', sk: 'INSPECTION#inspection-id' });
    return { Attributes: { ...command.input.Key, id: 'inspection-id', assetId: 'asset-id', status: 'completed', ...completion } };
  });
  const result = await repos.inspections.completeInspection(scope, 'asset-id', 'inspection-id', completion);
  assert.equal(result.status, 'completed');
  assert.equal(result.pk, undefined);
});

test('pending cursor derives every Dynamo key from authorized scope', async () => {
  const repos = await repositories(async (command) => {
    assert.equal(command.constructor.name, 'QueryCommand');
    assert.equal(command.input.IndexName, 'PendingBySite');
    assert.equal(command.input.ExpressionAttributeValues[':pk'], 'ORG#org-a#SITE#north');
    assert.equal(command.input.ExpressionAttributeValues[':through'], '2026-11-20#\uffff');
    assert.deepEqual(command.input.ExclusiveStartKey, { pk: 'ORG#org-a#SITE#north#ASSET#asset-id', sk: 'INSPECTION#inspection-id', pendingSiteKey: 'ORG#org-a#SITE#north', pendingDueKey: '2026-11-19#asset-id#inspection-id' });
    return { Items: [] };
  });
  assert.deepEqual(await repos.inspections.listPending(scope, '2026-11-20', { limit: 25, after: '2026-11-19#asset-id#inspection-id' }), { items: [] });
});

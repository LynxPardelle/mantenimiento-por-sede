import test from 'node:test';
import assert from 'node:assert/strict';

const scope = { orgId: 'org-a', siteId: 'north' };
const privateKey = { pk: 'ORG#org-a#SITE#north', sk: 'PILOT' };
const cohortCode = 'pilot-' + 'a'.repeat(24);
const data = { startDate: '2026-11-21', timeZone: 'America/Mexico_City', scope: { description: 'Private scope' }, goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 }, baseline: { historyProtocol: 'Private protocol' } };
const now = '2026-11-20T00:00:00.000Z';
const registry = () => ({ cohort: { code: cohortCode, orgId: 'org-a', siteId: 'north', timeZone: 'America/Mexico_City', startDate: '2026-11-21', classification: 'technical', agreedAt: now, goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 } }, baseline: { code: cohortCode, capturedAt: now, source: 'participant-declared', period: { startDate: '2026-11-01', endDateExclusive: '2026-11-08', timeZone: 'America/Mexico_City' }, historyLookup: { attempts: 2, successful: 0, failed: 2, medianSuccessfulSeconds: null }, effortMinutes: { preparation: 0, recording: 2, assistance: 3 }, people: { coordinators: 1, technicians: 0 }, qualityCriterionCaptured: true } });
const key = item => item.pk + '|' + item.sk;
async function repository(client) {
  let module;
  try { module = await import('../functions/domain/pilot-repository.mjs'); }
  catch (error) { assert.fail(`Pilot repository must exist: ${error.code}`); }
  return module.createPilotRepository({ client, tableName: 'pilot-table' });
}
function memoryClient() {
  const rows = new Map();
  const calls = [];
  let rejectTransaction = false;
  const condition = input => {
    const current = rows.get(key(input.Item));
    if (input.ConditionExpression === 'attribute_not_exists(pk)') return !current;
    return current?.revision === input.ExpressionAttributeValues[':revision'] && current?.status === 'draft';
  };
  const client = { send: async command => {
    const input = command.input;
    calls.push(command);
    if (command.constructor.name === 'GetCommand') return { Item: structuredClone(rows.get(key(input.Key))) };
    if (command.constructor.name === 'PutCommand') {
      if (!condition(input)) throw Object.assign(new Error('Conditional failure'), { name: 'ConditionalCheckFailedException' });
      rows.set(key(input.Item), structuredClone(input.Item)); return {};
    }
    if (command.constructor.name === 'TransactWriteCommand') {
      if (rejectTransaction) throw Object.assign(new Error('write unavailable'), { name: 'ProvisionedThroughputExceededException' });
      if (input.TransactItems.some(({ Put }) => !condition(Put))) throw Object.assign(new Error('Conditional failure'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
      for (const { Put } of input.TransactItems) rows.set(key(Put.Item), structuredClone(Put.Item));
      return {};
    }
    throw new Error('unexpected command');
  } };
  return { client, rows, calls, failTransactions: () => { rejectTransaction = true; } };
}

test('draft writes are conditional, strongly read and stable on identical retries and concurrent saves', async () => {
  const fake = memoryClient(); const repo = await repository(fake.client);
  const args = { scope, actor: 'private-sub', expectedRevision: 0, data, now };
  const [a, b] = await Promise.all([repo.saveDraft(args), repo.saveDraft(args)]);
  assert.deepEqual(a, b);
  assert.equal(a.revision, 1);
  assert.equal(fake.rows.size, 1);
  const retry = await repo.saveDraft({ ...args, now: '2026-11-25T00:00:00.000Z' });
  assert.deepEqual(retry, a);
  await assert.rejects(repo.saveDraft({ ...args, data: { ...data, startDate: '2026-11-22' } }), error => error.statusCode === 409);
  const next = await repo.saveDraft({ ...args, expectedRevision: 1, now: '2026-11-21T00:00:00.000Z' });
  assert.equal(next.createdAt, now);
  assert.equal(next.revision, 2);
  for (const call of fake.calls.filter(c => c.constructor.name === 'GetCommand')) assert.equal(call.input.ConsistentRead, true);
  const firstPut = fake.calls.find(c => c.constructor.name === 'PutCommand').input;
  assert.equal(firstPut.TableName, 'pilot-table');
  assert.equal(firstPut.ConditionExpression, 'attribute_not_exists(pk)');
  assert.deepEqual({ pk: firstPut.Item.pk, sk: firstPut.Item.sk }, privateKey);
});

test('confirmation atomically writes private enrollment and the minimal export row and preserves replay', async () => {
  const fake = memoryClient(); const repo = await repository(fake.client);
  const draft = await repo.saveDraft({ scope, actor: 'private-sub', expectedRevision: 0, data, now });
  const record = { ...draft, status: 'enrolled', revision: 2, confirmedFromRevision: 1, code: cohortCode, confirmedBy: 'private-sub' };
  const args = { scope, actor: 'private-sub', expectedRevision: 1, record, registry: registry() };
  const [a, b] = await Promise.all([repo.enroll(args), repo.enroll(args)]);
  assert.deepEqual(a, b);
  assert.equal(fake.rows.size, 2);
  const transaction = fake.calls.find(c => c.constructor.name === 'TransactWriteCommand').input.TransactItems;
  assert.equal(transaction.length, 2);
  assert.ok(transaction.every(t => t.Put.TableName === 'pilot-table'));
  assert.equal(transaction[0].Put.ExpressionAttributeValues[':revision'], 1);
  assert.deepEqual(transaction[1].Put.Item, { pk: 'PILOT#REGISTRY', sk: 'COHORT#' + cohortCode, ...registry() });
  const exportedRow = fake.rows.get('PILOT#REGISTRY|COHORT#' + cohortCode);
  assert.ok(!JSON.stringify(exportedRow).includes('Private scope'));
  assert.ok(!JSON.stringify(exportedRow).includes('Private protocol'));
  assert.ok(!JSON.stringify(exportedRow).includes('private-sub'));
  await assert.rejects(repo.saveDraft({ scope, actor: 'private-sub', expectedRevision: 2, data, now }), error => error.statusCode === 409);
});

test('failed confirmation never publishes a partial enrollment or baseline', async () => {
  const fake = memoryClient(); const repo = await repository(fake.client);
  await repo.saveDraft({ scope, actor: 'actor', expectedRevision: 0, data, now });
  fake.failTransactions();
  await assert.rejects(repo.enroll({ scope, expectedRevision: 1, record: { ...data, status: 'enrolled', revision: 2 }, registry: registry() }));
  assert.equal(fake.rows.size, 1);
  assert.equal(fake.rows.get(key(privateKey)).status, 'draft');
});

test('an intervening draft edit wins over confirmation without publishing a stale registry row', async () => {
  const fake = memoryClient();
  let repo;
  let intervened = false;
  const client = { send: async command => {
    if (command.constructor.name === 'TransactWriteCommand' && !intervened) {
      intervened = true;
      await repo.saveDraft({ scope, actor: 'another-coordinator', expectedRevision: 1, data: { ...data, startDate: '2026-11-22' }, now });
    }
    return fake.client.send(command);
  } };
  repo = await repository(client);
  const draft = await repo.saveDraft({ scope, actor: 'actor', expectedRevision: 0, data, now });
  await assert.rejects(repo.enroll({ scope, expectedRevision: 1, record: { ...draft, status: 'enrolled', revision: 2, code: cohortCode, confirmedFromRevision: 1 }, registry: registry() }), error => error.statusCode === 409);
  assert.equal(fake.rows.size, 1);
  assert.equal(fake.rows.get(key(privateKey)).status, 'draft');
  assert.equal(fake.rows.get(key(privateKey)).startDate, '2026-11-22');
});

test('a transient transaction conflict retries the same enrollment and baseline without refreshing evidence time', async () => {
  const fake = memoryClient();
  let transactions = 0;
  const requests = [];
  const client = { send: async command => {
    if (command.constructor.name === 'TransactWriteCommand') {
      requests.push(structuredClone(command.input));
      if (++transactions === 1) throw Object.assign(new Error('temporary race'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'TransactionConflict' }] });
    }
    return fake.client.send(command);
  } };
  const repo = await repository(client);
  const draft = await repo.saveDraft({ scope, actor: 'actor', expectedRevision: 0, data, now });
  const enrolled = await repo.enroll({ scope, expectedRevision: 1, record: { ...draft, status: 'enrolled', revision: 2, code: cohortCode, confirmedFromRevision: 1 }, registry: registry() });
  assert.equal(enrolled.status, 'enrolled');
  assert.equal(fake.rows.size, 2);
  assert.deepEqual(requests[0], requests[1]);
});

test('registry export is consistent and explicitly paginated, projecting only the sanitized rows', async () => {
  const calls = []; let page = 0;
  const cursor = { pk: 'PILOT#REGISTRY', sk: 'COHORT#' + cohortCode };
  const client = { send: async command => {
    calls.push(command);
    return page++ === 0 ? { Items: [], LastEvaluatedKey: cursor } : { Items: [{ ...registry(), pk: 'ignored', sk: 'ignored', name: 'NEVER EXPORT', baseline: { ...registry().baseline, secret: 'NEVER EXPORT' }, cohort: { ...registry().cohort, note: 'NEVER EXPORT' } }] };
  } };
  const result = await (await repository(client)).exportRegistry();
  assert.equal(result.cohorts.length, 1);
  assert.equal(result.baselines[0].historyLookup.medianSuccessfulSeconds, null);
  assert.ok(!JSON.stringify(result).includes('NEVER EXPORT'));
  assert.equal(calls.length, 2);
  for (const { input } of calls) {
    assert.equal(input.ConsistentRead, true);
    assert.ok(!input.IndexName);
    assert.equal(input.ExpressionAttributeValues[':pk'], 'PILOT#REGISTRY');
    assert.equal(input.ExpressionAttributeValues[':prefix'], 'COHORT#');
    assert.deepEqual(Object.values(input.ExpressionAttributeNames).sort(), ['baseline', 'cohort', 'pk', 'sk', 'reviews'].sort());
  }
  assert.deepEqual(calls[1].input.ExclusiveStartKey, cursor);
});

test('corrupt registry, repeated cursors and partial export failures never become an empty successful result', async () => {
  const repeated = { pk: 'PILOT#REGISTRY', sk: 'COHORT#' + cohortCode };
  const cases = [
    { send: async () => ({ Items: [], LastEvaluatedKey: repeated }) },
    { send: async () => ({ Items: [], LastEvaluatedKey: { pk: 'PRIVATE', sk: 'COHORT#' + cohortCode } }) },
    { send: async () => ({ Items: [{ cohort: registry().cohort, baseline: { ...registry().baseline, people: { coordinators: null, technicians: 0 } } }] }) },
    { send: async () => { throw new Error('private DynamoDB detail'); } },
  ];
  for (const client of cases) await assert.rejects((await repository(client)).exportRegistry());
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotRepository } from '../functions/domain/pilot-repository.mjs';
import { summarizeReview, reviewPeriod } from '../functions/domain/pilot-review-metrics.mjs';
const scope = { orgId: 'org-a', siteId: 'north' },
  code = 'pilot-' + 'a'.repeat(24),
  stamp = '2026-11-20T00:00:00.000Z';
const enrollment = {
  code,
  classification: 'technical',
  startDate: '2026-11-01',
  timeZone: 'UTC',
  agreedAt: '2026-10-31T00:00:00.000Z',
};
const registry = () => ({
  pk: 'PILOT#REGISTRY',
  sk: `COHORT#${code}`,
  cohort: {
    ...enrollment,
    orgId: scope.orgId,
    siteId: scope.siteId,
    goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 },
  },
  baseline: {
    code,
    capturedAt: enrollment.agreedAt,
    source: 'participant-declared',
    period: { startDate: '2026-10-20', endDateExclusive: '2026-10-27', timeZone: 'UTC' },
    historyLookup: { attempts: 1, successful: 1, failed: 0, medianSuccessfulSeconds: 60 },
    effortMinutes: { preparation: 10, recording: 10, assistance: 0 },
    people: { coordinators: 1, technicians: 0 },
    qualityCriterionCaptured: true,
  },
});
const data = () => ({
  sameProtocol: true,
  historyAttempts: [{ success: true, seconds: 30 }],
  effortMinutes: { preparation: 0, recording: null, assistance: 0 },
  noteAssessment: { reviewed: null, useful: null },
  summary: 'Private summary',
  nextAction: 'Private action',
});
const key = (r) => `${r.pk}|${r.sk}`;
function storage() {
  const rows = new Map([[key(registry()), registry()]]),
    calls = [];
  let fail = false;
  const conditional = (input) => {
    const c = rows.get(key(input.Item)),
      v = input.ExpressionAttributeValues;
    if (input.ConditionExpression === 'attribute_not_exists(pk)') return !c;
    if (input.ConditionExpression.includes('#cohort.#code'))
      return (
        c?.cohort.code === v[':code'] &&
        (input.ConditionExpression.includes('attribute_not_exists')
          ? c?.reviewVersion === undefined
          : c?.reviewVersion === v[':version'])
      );
    return c?.revision === v[':revision'] && c?.status === v[':draft'];
  };
  const client = {
    send: async (command) => {
      calls.push(command);
      const i = command.input;
      switch (command.constructor.name) {
        case 'GetCommand':
          return { Item: structuredClone(rows.get(key(i.Key))) };
        case 'PutCommand':
          if (!conditional(i))
            throw Object.assign(Error('conditional'), { name: 'ConditionalCheckFailedException' });
          rows.set(key(i.Item), structuredClone(i.Item));
          return {};
        case 'TransactWriteCommand':
          if (fail)
            throw Object.assign(Error('unavailable'), { name: 'ProvisionedThroughputExceededException' });
          if (i.TransactItems.some((t) => !conditional(t.Put)))
            throw Object.assign(Error('conditional'), {
              name: 'TransactionCanceledException',
              CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
            });
          for (const t of i.TransactItems) rows.set(key(t.Put.Item), structuredClone(t.Put.Item));
          return {};
        case 'QueryCommand':
          return { Items: [...rows.values()].filter((r) => r.pk === 'PILOT#REGISTRY') };
        default:
          throw Error('unexpected');
      }
    },
  };
  return {
    rows,
    calls,
    client,
    fail: () => (fail = true),
    repo: createPilotRepository({ client, tableName: 'pilot-table' }),
  };
}
async function prepare(s, week) {
  const period = reviewPeriod(enrollment, week, new Date(stamp)).period;
  const args = {
    scope,
    enrollment,
    week,
    period,
    actor: 'private-actor',
    expectedRevision: 0,
    data: data(),
    now: stamp,
  };
  const draft = await s.repo.saveReviewDraft(args);
  const record = {
    ...draft,
    status: 'confirmed',
    revision: 2,
    confirmedFromRevision: 1,
    confirmedBy: 'private-actor',
    confirmedAt: stamp,
    updatedAt: stamp,
    attested: true,
  };
  return {
    args,
    draft,
    confirm: { scope, enrollment, week, expectedRevision: 1, record, summary: summarizeReview(record, code) },
  };
}
test('Dynamo weekly drafts use known private keys, strong reads and stable concurrent replay', async () => {
  const s = storage();
  const { args, draft } = await prepare(s, 1);
  assert.equal(draft.classification, 'technical');
  assert.equal(draft.sk, 'PILOT#WEEK#1');
  const [a, b] = await Promise.all([
    s.repo.saveReviewDraft({ ...args, now: '2027-01-01T00:00:00.000Z' }),
    s.repo.saveReviewDraft(args),
  ]);
  assert.deepEqual(a, draft);
  assert.deepEqual(a, b);
  await assert.rejects(
    s.repo.saveReviewDraft({ ...args, data: { ...data(), summary: 'changed' } }),
    (e) => e.statusCode === 409,
  );
  assert.ok(s.calls.filter((c) => c.constructor.name === 'GetCommand').every((c) => c.input.ConsistentRead));
});
test('simultaneous confirmation of different weeks retries registry versions without losing a week', async () => {
  const s = storage();
  const a = await prepare(s, 1),
    b = await prepare(s, 2);
  const results = await Promise.all([s.repo.confirmReview(a.confirm), s.repo.confirmReview(b.confirm)]);
  assert.ok(results.every((r) => r.status === 'confirmed'));
  const row = s.rows.get(key(registry()));
  assert.equal(row.reviewVersion, 2);
  assert.deepEqual(
    row.reviews.map((r) => r.week),
    [1, 2],
  );
  assert.ok(s.calls.filter((c) => c.constructor.name === 'TransactWriteCommand').length >= 3);
  assert.deepEqual(await s.repo.confirmReview(a.confirm), results[0]);
  const out = await s.repo.exportRegistry();
  assert.equal(out.reviews.length, 2);
  for (const secret of [
    'Private summary',
    'Private action',
    'private-actor',
    'confirmedBy',
    'historyAttempts',
  ])
    assert.ok(!JSON.stringify(out).includes(secret));
  assert.ok(
    s.calls.every((c) => !['UpdateCommand', 'ScanCommand', 'DeleteCommand'].includes(c.constructor.name)),
  );
});
test('failed weekly confirmation publishes neither private confirmation nor export summary', async () => {
  const s = storage();
  const a = await prepare(s, 1);
  s.fail();
  await assert.rejects(s.repo.confirmReview(a.confirm));
  assert.equal((await s.repo.getReview(scope, 1)).status, 'draft');
  assert.equal(s.rows.get(key(registry())).reviews, undefined);
});
test('weekly export rejects malformed periods, duplicate weeks and incomplete aggregate values', async () => {
  const s = storage();
  const a = await prepare(s, 1);
  await s.repo.confirmReview(a.confirm);
  const source = structuredClone(s.rows.get(key(registry())));
  for (const change of [
    (r) => r.reviews.push(r.reviews[0]),
    (r) => (r.reviews[0].period.endDateExclusive = '2026-11-09'),
    (r) => (r.reviews[0].effortMinutes.preparation = undefined),
    (r) => (r.reviews[0].noteAssessment = { reviewed: 1, useful: 2, usefulRate: 2 }),
  ]) {
    const bad = structuredClone(source);
    change(bad);
    s.rows.set(key(bad), bad);
    await assert.rejects(s.repo.exportRegistry());
  }
});

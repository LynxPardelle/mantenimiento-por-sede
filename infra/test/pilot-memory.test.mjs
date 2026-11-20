import test from 'node:test';
import assert from 'node:assert/strict';

async function repository() {
  let module;
  try { module = await import('../functions/domain/pilot-memory.mjs'); }
  catch (error) { assert.fail(`Memory pilot repository must exist: ${error.code}`); }
  return module.createMemoryPilotRepository();
}
test('memory pilot draft isolates sites, copies boundaries and preserves its first successful retry', async () => {
  const repo = await repository();
  const scope = { orgId: 'org-a', siteId: 'north' };
  const args = { scope, actor: 'actor', expectedRevision: 0, data: { startDate: '', goals: { onTimeRateTarget: null } }, now: '2026-11-20T00:00:00.000Z' };
  const a = await repo.saveDraft(args);
  args.data.goals.onTimeRateTarget = 1;
  a.goals.onTimeRateTarget = 0.5;
  assert.equal((await repo.get(scope)).goals.onTimeRateTarget, null);
  const retry = await repo.saveDraft({ ...args, data: { startDate: '', goals: { onTimeRateTarget: null } }, now: '2026-11-21T00:00:00.000Z' });
  assert.equal(retry.updatedAt, '2026-11-20T00:00:00.000Z');
  assert.equal(await repo.get({ orgId: 'org-b', siteId: 'north' }), undefined);
  await assert.rejects(repo.saveDraft(args), error => error.statusCode === 409);
  assert.deepEqual(await repo.exportRegistry(), { schemaVersion: 1, cohorts: [], baselines: [] });
});

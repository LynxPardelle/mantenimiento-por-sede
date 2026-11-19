import test from 'node:test';
import assert from 'node:assert/strict';
import { observePilot } from './observe.mjs';
import { collectCohort } from './collect.mjs';

const fixture = () => {
  const writes = [];
  const objects = new Map([['production/registry.json', { schemaVersion: 1, cohorts: [] }]]);
  const aws = args => {
    if (args[0] === 'cloudwatch') return { MetricAlarms: ['platform', 'assets', 'inspections', 'frontend'].map(name => ({ AlarmName: `sedepulso-production-${name}-errors`, StateValue: 'OK', AlarmActions: [] })) };
    if (args[0] === 'dynamodb' && args[1] === 'describe-table') return { Table: { TableStatus: 'ACTIVE', ItemCount: 0 } };
    throw new Error('unexpected read');
  };
  return { writes, objects, dependencies: {
    aws,
    describeStack: name => ({ status: 'UPDATE_COMPLETE', outputs: { AccessTableName: 'access', AssetsTableName: 'assets', InspectionsTableName: 'inspections' }, alarmNames: [`${name}-errors`] }),
    readJson: async key => { if (!objects.has(key)) throw new Error('missing'); return objects.get(key); },
    putJson: async (key, value, options) => { writes.push({ key, value, options }); return true; },
    fetchJson: async url => url.endsWith('/api/config') ? { signupEnabled: true, billingEnabled: false } : { status: 'ok' },
    collect: () => { throw new Error('must not query a cohort that does not exist'); },
  } };
};

test('empty registry reports readiness and missing observations without starting a pilot', async () => {
  const f = fixture();
  const r = await observePilot({ ...f.dependencies, environment: 'production', checkedAt: '2026-11-19T23:00:00.000Z', runId: 'test-1', sourceCommit: 'a'.repeat(40) });
  assert.equal(r.status, 'awaiting-participant');
  assert.equal(r.pilotWeek, null);
  assert.equal(r.safety.billingEnabled, false);
  assert.equal(r.operations.alarmNotificationsConfigured, false);
  assert.equal(r.operations.tableMetadata.access.approximateItems, 0);
  assert.match(r.operations.tableMetadata.access.caveat, /six hours/);
  assert.equal(f.writes.length, 2);
  assert.ok(f.writes.some(w => w.key === 'production/reports/latest.json'));
  assert.ok(f.writes.some(w => w.options?.ifAbsent));
});

test('registry failure or an enabled billing flag fails instead of publishing a healthy zero report', async () => {
  const f = fixture();
  await assert.rejects(observePilot({ ...f.dependencies, environment: 'production', readJson: async () => { throw new Error('private reason'); } }), /registry/);
  assert.equal(f.writes.length, 0);
  await assert.rejects(observePilot({ ...f.dependencies, environment: 'production', fetchJson: async url => url.endsWith('/api/config') ? { signupEnabled: true, billingEnabled: true } : { status: 'ok' } }), /billing/);
  assert.equal(f.writes.length, 0);
});

test('failed stack and incomplete alarm evidence are never reported healthy', async () => {
  const f = fixture();
  await assert.rejects(observePilot({ ...f.dependencies, environment: 'production', describeStack: () => ({ status: 'UPDATE_ROLLBACK_COMPLETE', outputs: {} }) }), /stack/);
  await assert.rejects(observePilot({ ...f.dependencies, environment: 'production', aws: args => args[0] === 'cloudwatch' ? { MetricAlarms: [], NextToken: 'more' } : f.dependencies.aws(args) }), /alarms/);
});

test('collector metadata stays outside the pure engine and closed weeks are write-once', async () => {
  const f = fixture();
  f.objects.set('production/registry.json', { schemaVersion: 1, cohorts: [{ code: 'pilot-a', orgId: 'private-org', siteId: 'private-site', timeZone: 'Etc/GMT+6', startDate: '2026-11-01', classification: 'enrolled-real', agreedAt: '2026-10-30T00:00:00Z', goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 } }] });
  const r = await observePilot({ ...f.dependencies, checkedAt: '2026-11-10T13:00:00.000Z', environment: 'production', collect: collectCohort, aws: args => args[1] === 'query' ? { Items: [], ConsumedCapacity: { CapacityUnits: 0.5 } } : f.dependencies.aws(args) });
  assert.equal(r.status, 'collecting');
  assert.equal(r.pilotWeek, 2);
  assert.equal(r.operations.collectorReadCapacityUnits, 0.5);
  assert.equal(r.weeklySnapshots.length, 1);
  assert.match(r.weeklySnapshots[0].key, /weekly\/pilot-a\/2026-11-01\/week-1.json$/);
  assert.equal(f.writes.find(w => w.key.includes('/weekly/')).options.ifAbsent, true);
  assert.ok(!JSON.stringify(r).includes('private-org'));
  assert.ok(!JSON.stringify(r).includes('private-site'));
});

test('latest and totals use the saved weekly cut rather than a later reconstruction', async () => {
  const f = fixture();
  f.objects.set('production/registry.json', { schemaVersion: 1, cohorts: [{ code: 'pilot-a', orgId: 'org', siteId: 'site', timeZone: 'Etc/GMT+6', startDate: '2026-11-01', classification: 'enrolled-real', agreedAt: '2026-10-30T00:00:00Z', goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 } }] });
  const putJson = async (key, value, options) => {
    if (options?.ifAbsent && f.objects.has(key)) return false;
    f.objects.set(key, structuredClone(value));
    return true;
  };
  const common = { ...f.dependencies, putJson, environment: 'production', checkedAt: '2026-11-10T13:00:00.000Z' };
  await observePilot({ ...common, collect: async () => ({ code: 'pilot-a', assets: [], inspections: [], readCapacityUnits: 0.5 }) });
  const r = await observePilot({ ...common, runId: 'second', collect: async () => ({ code: 'pilot-a', assets: [{ id: 'a', status: 'operational' }], inspections: [{ id: 'i', assetId: 'a', dueDate: '2026-11-02', status: 'pending', hasNote: false, hasAuthor: false }], readCapacityUnits: 0.5 }) });
  assert.equal(r.cohorts[0].weeks[0].onTime.denominator, 0);
  assert.equal(r.totals['enrolled-real'].onTime.denominator, 0);
  assert.equal(r.weeklySnapshots[0].created, false);
});

test('describes exact alarms discovered in own stacks instead of requesting the account alarm wildcard', async () => {
  const f = fixture();
  const names = ['sedepulso-production-platform-errors', 'sedepulso-production-assets-errors', 'sedepulso-production-inspections-errors', 'sedepulso-production-frontend-errors'];
  const calls = [];
  await observePilot({ ...f.dependencies, environment: 'production', describeStack: name => ({ ...f.dependencies.describeStack(name), alarmNames: [names.find(n => n.startsWith(name))] }), aws: args => {
    if (args[0] === 'cloudwatch') { calls.push(args); return { MetricAlarms: names.map(AlarmName => ({ AlarmName, StateValue: 'OK', AlarmActions: [] })) }; }
    return f.dependencies.aws(args);
  } });
  assert.ok(calls[0].includes('--alarm-names'));
  assert.ok(!calls[0].includes('--alarm-name-prefix'));
  assert.deepEqual(calls[0].slice(calls[0].indexOf('--alarm-names') + 1, calls[0].indexOf('--region')), names);
});

import assert from 'node:assert/strict';
import test from 'node:test';

async function implementation() {
  try { return await import('./metrics.mjs'); }
  catch { assert.fail('The private pilot metrics engine must be implemented.'); }
}
const cohort = (overrides = {}) => ({ code: 'pilot-north', orgId: 'org-private', siteId: 'site-private', timeZone: 'America/Mexico_City', startDate: '2026-11-01', classification: 'enrolled-real', agreedAt: '2026-10-30T18:00:00.000Z', goals: { onTimeRateTarget: 0.8, minimumDueInspections: 2 }, ...overrides });
const asset = (id = 'asset-private', overrides = {}) => ({ id, status: 'operational', ...overrides });
const inspection = (id, overrides = {}) => ({ id, assetId: 'asset-private', dueDate: '2026-11-02', status: 'pending', hasNote: false, hasAuthor: false, ...overrides });
const observed = (inspections = [], overrides = {}) => ({ code: 'pilot-north', assets: [asset()], inspections, ...overrides });

test('an empty registry awaits a real participant without inventing a week or measurements', async () => {
  const { summarizePilot, validateRegistry } = await implementation();
  assert.deepEqual(validateRegistry({ schemaVersion: 1, cohorts: [] }), { schemaVersion: 1, cohorts: [] });
  const report = summarizePilot({ cohorts: [], observations: [], checkedAt: '2026-11-19T16:00:00Z' });
  assert.equal(report.status, 'awaiting-participant');
  assert.equal(report.pilotWeek, null);
  assert.deepEqual(report.cohorts, []);
  assert.ok(report.unmeasured.includes('commercialAcceptance'));
  assert.ok(report.unmeasured.includes('awsCost'));
});

test('registry rejects invented dates, invalid zones, duplicates, undeclared data and an agreement after local start', async () => {
  const { validateRegistry } = await implementation();
  for (const entry of [cohort({ startDate: '2026-02-30' }), cohort({ timeZone: 'Moon/North' }), cohort({ agreedAt: '2026-11-02T12:00:00Z' }), cohort({ agreedAt: '2026-02-30T12:00:00Z' }), cohort({ name: 'Personal name' }), cohort({ classification: 'registered' }), cohort({ goals: { onTimeRateTarget: 1.1, minimumDueInspections: 0 } })]) {
    assert.throws(() => validateRegistry({ schemaVersion: 1, cohorts: [entry] }), /invalid_registry/);
  }
  assert.throws(() => validateRegistry({ schemaVersion: 1, cohorts: [cohort(), cohort()] }), /invalid_registry/);
  assert.throws(() => validateRegistry({ schemaVersion: 1, cohorts: [cohort(), cohort({ code: 'other' })] }), /invalid_registry/);
  const input = { schemaVersion: 1, cohorts: [cohort()] };
  const validated = validateRegistry(input);
  validated.cohorts[0].goals.minimumDueInspections = 3;
  assert.equal(input.cohorts[0].goals.minimumDueInspections, 2);
});

test('punctuality uses local completion date and includes pending inspections in the due denominator', async () => {
  const { summarizePilot } = await implementation();
  const report = summarizePilot({ cohorts: [cohort()], observations: [observed([
    inspection('on-time', { status: 'completed', result: 'ok', completedAt: '2026-11-03T05:30:00Z', hasNote: true, hasAuthor: true }),
    inspection('late', { status: 'completed', result: 'attention', completedAt: '2026-11-03T06:30:00Z', hasAuthor: true }),
    inspection('pending'),
    inspection('backlog', { dueDate: '2026-10-31' }),
    inspection('next', { dueDate: '2026-11-08' }),
  ])], checkedAt: '2026-11-08T12:00:00Z' });
  const week = report.cohorts[0].weeks[0];
  assert.deepEqual(week.onTime, { numerator: 1, denominator: 3, rate: 1 / 3 });
  assert.equal(week.closedInPeriod, 2);
  assert.deepEqual(week.structuralEvidence, { numerator: 1, denominator: 2, rate: 0.5 });
  assert.deepEqual(week.results, { ok: 1, attention: 1, failed: 0 });
  assert.equal(week.priorBacklog, 1);
  assert.equal(week.startDate, '2026-11-01');
  assert.equal(week.endDateExclusive, '2026-11-08');
  assert.equal(week.cutoffUtc, '2026-11-08T06:00:00.000Z');
  assert.equal(week.status, 'closed');
  assert.equal(report.cohorts[0].weeks[1].status, 'in-progress');
  assert.equal(report.cohorts[0].weeks[2].status, 'future');
  assert.equal(report.cohorts[0].weeks[2].onTime.rate, null);
});

test('a snapshot before completion preserves pending-at-cutoff and ignores records created after the cutoff', async () => {
  const { summarizePilot } = await implementation();
  const entries = [
    inspection('after-close', { status: 'completed', result: 'ok', completedAt: '2026-11-09T12:00:00Z', hasNote: true, hasAuthor: true, createdAt: '2026-11-01T12:00:00Z' }),
    inspection('late-added', { createdAt: '2026-11-09T13:00:00Z' }),
  ];
  const report = summarizePilot({ cohorts: [cohort()], observations: [observed(entries, { assets: [asset('asset-private', { createdAt: '2026-11-01T12:00:00Z' })] })], checkedAt: '2026-11-10T12:00:00Z' });
  const week = report.cohorts[0].weeks[0];
  assert.deepEqual(week.onTime, { numerator: 0, denominator: 1, rate: 0 });
  assert.equal(week.closedInPeriod, 0);
  assert.equal(week.coverage.inspectionsCreatedAfterCutoff, 1);
  assert.equal(week.coverage.legacyMissingCreatedAt.inspections, 0);
});

test('legacy timestamps and unmeasured usefulness remain explicit and zero denominators stay null', async () => {
  const { summarizePilot } = await implementation();
  const report = summarizePilot({ cohorts: [cohort()], observations: [observed([inspection('legacy')])], checkedAt: '2026-11-08T12:00:00Z' });
  const first = report.cohorts[0].weeks[0];
  assert.deepEqual(first.coverage.legacyMissingCreatedAt, { assets: 1, inspections: 1 });
  assert.equal(first.coverage.historicalCompleteness, 'limited');
  assert.deepEqual(first.structuralEvidence, { numerator: 0, denominator: 0, rate: null });
  assert.ok(report.cohorts[0].unmeasured.includes('noteUsefulness'));
  assert.ok(report.cohorts[0].unmeasured.includes('historyLookupBaseline'));
  assert.equal(report.cohorts[0].weeks[1].onTime.rate, null);
});

test('local week boundaries follow daylight saving rather than seven elapsed UTC days', async () => {
  const { summarizePilot } = await implementation();
  const report = summarizePilot({ cohorts: [cohort({ timeZone: 'America/New_York' })], observations: [observed()], checkedAt: '2026-11-08T12:00:00Z' });
  const week = report.cohorts[0].weeks[0];
  assert.equal(week.startUtc, '2026-11-01T04:00:00.000Z');
  assert.equal(week.cutoffUtc, '2026-11-08T05:00:00.000Z');
  assert.equal((Date.parse(week.cutoffUtc) - Date.parse(week.startUtc)) / 3600000, 169);
});

test('pilot zones must be IANA names rather than fixed offset shortcuts', async () => {
  const { validateRegistry } = await implementation();
  assert.throws(() => validateRegistry({ schemaVersion: 1, cohorts: [cohort({ timeZone: '+05:30' })] }), /invalid_registry/);
  assert.equal(validateRegistry({ schemaVersion: 1, cohorts: [cohort({ timeZone: 'Etc/GMT+6' })] }).cohorts[0].timeZone, 'Etc/GMT+6');
});

test('a completion exactly at local week midnight belongs only to the following interval', async () => {
  const { summarizePilot } = await implementation();
  const report = summarizePilot({ cohorts: [cohort()], observations: [observed([inspection('boundary', { dueDate: '2026-11-07', status: 'completed', result: 'ok', completedAt: '2026-11-08T06:00:00Z', hasNote: true, hasAuthor: true })])], checkedAt: '2026-11-09T12:00:00Z' });
  assert.equal(report.cohorts[0].weeks[0].closedInPeriod, 0);
  assert.equal(report.cohorts[0].weeks[1].closedInPeriod, 1);
  assert.equal(report.totals['enrolled-real'].closedInPeriod, 1);
});

test('technical activity cannot enrol a real participant and aggregate rates sum counts', async () => {
  const { summarizePilot } = await implementation();
  const technical = cohort({ code: 'technical', classification: 'technical', orgId: 'org-test', siteId: 'site-test' });
  const onlyTechnical = summarizePilot({ cohorts: [technical], observations: [observed([], { code: 'technical' })], checkedAt: '2026-11-08T12:00:00Z' });
  assert.equal(onlyTechnical.status, 'awaiting-participant');
  assert.equal(onlyTechnical.pilotWeek, null);
  const second = cohort({ code: 'south', orgId: 'org-other', siteId: 'site-other' });
  const completed = inspection('complete', { status: 'completed', result: 'ok', completedAt: '2026-11-02T12:00:00Z', hasNote: true, hasAuthor: true });
  const report = summarizePilot({ cohorts: [cohort(), second, technical], observations: [observed([completed]), observed([inspection('p1'), inspection('p2'), inspection('p3')], { code: 'south' }), observed([completed], { code: 'technical' })], checkedAt: '2026-11-08T12:00:00Z' });
  assert.deepEqual(report.totals['enrolled-real'].onTime, { numerator: 1, denominator: 4, rate: 0.25 });
  assert.deepEqual(report.totals.technical.onTime, { numerator: 1, denominator: 1, rate: 1 });
});

test('the report strips internal identifiers and never invents commercial completion after four weeks', async () => {
  const { summarizePilot } = await implementation();
  const report = summarizePilot({ cohorts: [cohort()], observations: [observed([inspection('inspection-private')])], checkedAt: '2026-12-05T12:00:00Z' });
  assert.equal(report.status, 'observation-window-ended');
  assert.equal(report.cohorts[0].weeks.length, 4);
  const serialized = JSON.stringify(report);
  for (const secret of ['org-private', 'site-private', 'asset-private', 'inspection-private']) assert.equal(serialized.includes(secret), false);
  assert.ok(report.unmeasured.includes('operationalEffortMinutes'));
  assert.ok(report.unmeasured.includes('commercialAcceptance'));
});

test('missing observations are not silently converted into an empty observed database', async () => {
  const { summarizePilot } = await implementation();
  const report = summarizePilot({ cohorts: [cohort()], observations: [], checkedAt: '2026-11-08T12:00:00Z' });
  const week = report.cohorts[0].weeks[0];
  assert.equal(week.coverage.observationMissing, true);
  assert.deepEqual(week.onTime, { numerator: null, denominator: null, rate: null });
  assert.equal(week.inventory, null);
});

test('the pure engine rejects duplicate or personal observation fields and invalid cutoffs', async () => {
  const { summarizePilot } = await implementation();
  const base = { cohorts: [cohort()], observations: [observed()], checkedAt: '2026-11-08T12:00:00Z' };
  for (const change of [
    { checkedAt: '2026-02-30T12:00:00Z' },
    { observations: [observed(), observed()] },
    { observations: [observed([inspection('one'), inspection('one')])] },
    { observations: [observed([], { assets: [asset(), asset()] })] },
    { observations: [observed([inspection('one', { note: 'private text' })])] },
    { observations: [observed([inspection('one', { completedBy: 'subject-private' })])] },
  ]) assert.throws(() => summarizePilot({ ...base, ...change }), /invalid_/);
});

test('totals can be rebuilt after frozen weekly snapshots replace recalculated windows', async () => {
  const { summarizePilot, aggregatePilotTotals } = await implementation();
  assert.equal(typeof aggregatePilotTotals, 'function', 'Frozen weekly snapshots need a reusable totals aggregator.');
  const second = cohort({ code: 'south', orgId: 'org-other', siteId: 'site-other' });
  const complete = inspection('complete', { status: 'completed', result: 'ok', completedAt: '2026-11-02T12:00:00Z', hasNote: true, hasAuthor: true });
  const report = summarizePilot({ cohorts: [cohort(), second], observations: [observed([complete]), observed([inspection('p1'), inspection('p2'), inspection('p3')], { code: 'south' })], checkedAt: '2026-11-08T12:00:00Z' });
  assert.deepEqual(aggregatePilotTotals(report.cohorts), report.totals);
  const frozen = structuredClone(report.cohorts[1].weeks[0]);
  frozen.onTime = { numerator: 2, denominator: 4, rate: 0.5 };
  frozen.structuralEvidence = { numerator: 1, denominator: 2, rate: 0.5 };
  frozen.closedInPeriod = 2;
  report.cohorts[1].weeks[0] = frozen;
  const totals = aggregatePilotTotals(report.cohorts);
  assert.deepEqual(totals['enrolled-real'].onTime, { numerator: 3, denominator: 5, rate: 0.6 });
  assert.deepEqual(totals['enrolled-real'].structuralEvidence, { numerator: 2, denominator: 3, rate: 2 / 3 });
  assert.equal(totals['enrolled-real'].closedInPeriod, 3);
  assert.deepEqual(totals.technical.onTime, { numerator: null, denominator: null, rate: null });
});

test('rebuilt totals derive missing observations from retained weekly coverage', async () => {
  const { summarizePilot, aggregatePilotTotals } = await implementation();
  assert.equal(typeof aggregatePilotTotals, 'function', 'Frozen weekly snapshots need a reusable totals aggregator.');
  const report = summarizePilot({ cohorts: [cohort()], observations: [], checkedAt: '2026-11-08T12:00:00Z' });
  assert.equal(aggregatePilotTotals(report.cohorts)['enrolled-real'].missingObservationCohorts, 1);
  const prior = summarizePilot({ cohorts: [cohort()], observations: [observed()], checkedAt: '2026-11-08T12:00:00Z' });
  report.cohorts[0].weeks[0] = prior.cohorts[0].weeks[0];
  assert.equal(aggregatePilotTotals(report.cohorts)['enrolled-real'].missingObservationCohorts, 0);
  assert.throws(() => aggregatePilotTotals(null), /invalid_reports/);
});

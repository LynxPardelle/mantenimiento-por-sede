import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePilotEnrollments } from './enrollments.mjs';
import { observePilot } from './observe.mjs';

const code = `pilot-${'a'.repeat(24)}`;
const cohort = { code, orgId: 'private-org', siteId: 'private-site', timeZone: 'Etc/GMT+6', startDate: '2026-11-02', classification: 'enrolled-real', agreedAt: '2026-11-01T12:00:00.000Z', goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 } };
const baseline = { code, capturedAt: cohort.agreedAt, source: 'participant-declared', period: { startDate: '2026-10-25', endDateExclusive: '2026-11-01', timeZone: cohort.timeZone }, historyLookup: { attempts: 2, successful: 1, failed: 1, medianSuccessfulSeconds: 30 }, effortMinutes: { preparation: 10, recording: 5, assistance: 0 }, people: { coordinators: 1, technicians: 0 }, qualityCriterionCaptured: true };
const review = { code, week: 1, capturedAt: '2026-11-09T06:00:00.000Z', source: 'participant-declared', period: { startDate: '2026-11-02', endDateExclusive: '2026-11-09', timeZone: cohort.timeZone }, historyLookup: { attempts: 2, successful: 2, failed: 0, medianSuccessfulSeconds: 15 }, effortMinutes: { preparation: 5, recording: 0, assistance: 0 }, noteAssessment: { reviewed: 2, useful: 1, usefulRate: 0.5 }, sameProtocol: true };
const exported = () => ({ schemaVersion: 1, cohorts: [structuredClone(cohort)], baselines: [structuredClone(baseline)], reviews: [structuredClone(review)] });
const args = () => ({ registry: { schemaVersion: 1, cohorts: [] }, exported: exported(), checkedAt: '2026-11-10T13:00:00.000Z' });

test('accepts the legacy export without reviews as absent measurements', () => {
  const a = args(); delete a.exported.reviews;
  const result = mergePilotEnrollments(a);
  assert.deepEqual(result.reviews, []);
  assert.equal(result.deferredReviews, 0);
});

test('merges only confirmed aggregate reviews and defers capture after the observer cut', () => {
  const a = args();
  const result = mergePilotEnrollments(a);
  assert.deepEqual(result.reviews, [review]);
  assert.equal(result.deferredReviews, 0);
  a.checkedAt = '2026-11-09T05:59:59.999Z';
  const deferred = mergePilotEnrollments(a);
  assert.deepEqual(deferred.reviews, []);
  assert.equal(deferred.deferredReviews, 1);
});

test('review export rejects personal fields, duplicate windows and altered period or aggregates', () => {
  const mutations = [
    r => { r.summary = 'private findings'; },
    r => { r.historyLookup.actor = 'private person'; },
    r => { r.period.startDate = '2026-11-03'; },
    r => { r.period.endDateExclusive = '2026-11-10'; },
    r => { r.period.timeZone = 'Etc/UTC'; },
    r => { r.week = 0; },
    r => { r.week = 5; },
    r => { r.week = 1.5; },
    r => { r.code = 'unknown'; },
    r => { r.capturedAt = '2026-11-09T05:59:59.999Z'; },
    r => { r.source = 'observed-by-server'; },
    r => { r.historyLookup.attempts = 31; },
    r => { r.historyLookup.failed = 1; },
    r => { r.historyLookup.medianSuccessfulSeconds = null; },
    r => { r.effortMinutes.recording = -1; },
    r => { r.effortMinutes.assistance = 10081; },
    r => { r.noteAssessment.useful = 3; },
    r => { r.noteAssessment.usefulRate = 1; },
    r => { r.sameProtocol = 'yes'; },
  ];
  for (const mutate of mutations) {
    const a = args(); mutate(a.exported.reviews[0]);
    assert.throws(() => mergePilotEnrollments(a), /invalid_application_enrollments/);
  }
  const duplicate = args(); duplicate.exported.reviews.push(structuredClone(review));
  assert.throws(() => mergePilotEnrollments(duplicate), /invalid_application_enrollments/);
});

test('a weekly review with no samples preserves absent measurements rather than inventing zeros', () => {
  const a = args();
  a.exported.reviews[0].historyLookup = { attempts: 0, successful: 0, failed: 0, medianSuccessfulSeconds: null };
  a.exported.reviews[0].effortMinutes = { preparation: null, recording: 0, assistance: null };
  a.exported.reviews[0].noteAssessment = { reviewed: null, useful: null, usefulRate: null };
  a.exported.reviews[0].sameProtocol = null;
  const result = mergePilotEnrollments(a);
  assert.deepEqual(result.reviews, a.exported.reviews);
});

function observerFixture() {
  const objects = new Map([['production/registry.json', { schemaVersion: 1, cohorts: [] }]]);
  let app = exported(); app.reviews = [];
  return { objects, setReviews: reviews => { app.reviews = reviews; }, setBaseline: value => { app.baselines = [value]; }, dependencies: {
    environment: 'production', checkedAt: '2026-11-10T13:00:00.000Z',
    describeStack: name => ({ status: 'UPDATE_COMPLETE', outputs: { AccessTableName: 'access', AssetsTableName: 'assets', InspectionsTableName: 'inspections', PilotExportFunctionName: 'exporter' }, alarmNames: [`${name}-errors`] }),
    getEnrollments: async () => structuredClone(app),
    readJson: async key => { if (!objects.has(key)) throw new Error('missing'); return structuredClone(objects.get(key)); },
    putJson: async (key, value, options) => { if (options?.ifAbsent && objects.has(key)) return false; objects.set(key, structuredClone(value)); return true; },
    fetchJson: async url => url.endsWith('/api/config') ? { billingEnabled: false, signupEnabled: true } : { status: 'ok' },
    aws: args => args[0] === 'cloudwatch' ? { MetricAlarms: ['platform', 'assets', 'inspections', 'pilot', 'frontend'].map(name => ({ AlarmName: `sedepulso-production-${name}-errors`, StateValue: 'OK', AlarmActions: [] })) } : { Table: { TableStatus: 'ACTIVE', ItemCount: 0 } },
    collect: async () => ({ code, assets: [], inspections: [], readCapacityUnits: 0.5 }),
  } };
}

test('late confirmed review appears beside the immutable operational week without changing that snapshot', async () => {
  const f = observerFixture();
  const first = await observePilot(f.dependencies);
  assert.deepEqual(first.cohorts[0].weeklyReviews, []);
  const key = `production/reports/weekly/${code}/2026-11-02/week-1.json`;
  const frozen = structuredClone(f.objects.get(key));
  f.setReviews([structuredClone(review)]);
  const next = await observePilot({ ...f.dependencies, runId: 'second' });
  assert.deepEqual(f.objects.get(key), frozen);
  assert.deepEqual(next.cohorts[0].weeks[0], frozen.week);
  assert.equal(next.cohorts[0].weeklyReviews[0].historyLookup.attempts, 2);
  assert.equal(next.cohorts[0].weeklyReviews[0].comparison.history.deltaSeconds, -15);
  assert.equal(next.cohorts[0].weeklyReviews[0].comparison.history.successRateDeltaPoints, 50);
  assert.equal(next.cohorts[0].weeklyReviews[0].comparison.effortMinutes.total.delta, -10);
  assert.equal(next.operations.deferredApplicationReviews, 0);
  // A single declared week does not measure all four weeks or the commercial decision.
  for (const missing of ['historyLookupMedianSeconds', 'operationalEffortMinutes', 'commercialAcceptance']) assert.ok(next.cohorts[0].unmeasured.includes(missing));
});

test('no-sample and changed-method reviews do not acquire comparison deltas in observer output', async () => {
  const f = observerFixture();
  const noSamples = { ...structuredClone(review), sameProtocol: null, historyLookup: { attempts: 0, successful: 0, failed: 0, medianSuccessfulSeconds: null }, effortMinutes: { preparation: null, recording: null, assistance: null }, noteAssessment: { reviewed: 0, useful: 0, usefulRate: null } };
  f.setReviews([noSamples]);
  const result = await observePilot(f.dependencies);
  const comparison = result.cohorts[0].weeklyReviews[0].comparison;
  assert.equal(comparison.comparable, false);
  assert.equal(comparison.reason, 'not-attested');
  assert.equal(comparison.history.deltaSeconds, null);
  assert.equal(comparison.effortMinutes.total.delta, null);
  assert.equal(comparison.noteUsefulness.rate, null);
  f.setReviews([{ ...structuredClone(review), sameProtocol: false }]);
  const changed = await observePilot({ ...f.dependencies, runId: 'changed-method' });
  assert.equal(changed.cohorts[0].weeklyReviews[0].comparison.reason, 'different-protocol');
  assert.equal(changed.cohorts[0].weeklyReviews[0].comparison.history.changePercent, null);
});

test('an explicitly zero baseline median keeps an absolute difference without a percentage', async () => {
  const f = observerFixture();
  f.setBaseline({ ...structuredClone(baseline), historyLookup: { attempts: 1, successful: 1, failed: 0, medianSuccessfulSeconds: 0 } });
  f.setReviews([structuredClone(review)]);
  const result = await observePilot(f.dependencies);
  const history = result.cohorts[0].weeklyReviews[0].comparison.history;
  assert.equal(history.baselineMedianSeconds, 0);
  assert.equal(history.reviewMedianSeconds, 15);
  assert.equal(history.deltaSeconds, 15);
  assert.equal(history.changePercent, null);
});

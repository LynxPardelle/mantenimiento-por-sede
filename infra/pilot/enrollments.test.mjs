import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePilotEnrollments } from './enrollments.mjs';

const cohort = { code: 'pilot-app', orgId: 'org-app', siteId: 'site-app', timeZone: 'America/Mexico_City', startDate: '2026-11-21', classification: 'enrolled-real', agreedAt: '2026-11-20T00:00:00.000Z', goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 } };
const baseline = { code: cohort.code, capturedAt: cohort.agreedAt, source: 'participant-declared', period: { startDate: '2026-11-12', endDateExclusive: '2026-11-19', timeZone: cohort.timeZone }, historyLookup: { attempts: 3, successful: 2, failed: 1, medianSuccessfulSeconds: 25 }, effortMinutes: { preparation: 20, recording: 10, assistance: 0 }, people: { coordinators: 1, technicians: 2 }, qualityCriterionCaptured: true };
const args = () => ({ registry: { schemaVersion: 1, cohorts: [] }, exported: { schemaVersion: 1, cohorts: [structuredClone(cohort)], baselines: [structuredClone(baseline)] }, checkedAt: '2026-11-20T01:00:00.000Z' });

test('merges application enrollments with preserved administrative cohorts and declared baselines', () => {
  const input = args();
  input.registry.cohorts.push({ ...cohort, code: 'manual', orgId: 'other', siteId: 'other' });
  const result = mergePilotEnrollments(input);
  assert.equal(result.registry.cohorts.length, 2);
  assert.deepEqual(result.baselines, [baseline]);
  assert.equal(result.deferredEnrollments, 0);
});

test('rejects extra personal fields, mismatched baseline counts and incomplete exports', () => {
  for (const mutate of [
    a => { a.exported.baselines[0].historyProtocol = 'private text'; },
    a => { a.exported.baselines[0].historyLookup.successful = 4; },
    a => { a.exported.baselines = []; },
    a => { a.exported.baselines[0].source = 'observed-by-server'; },
    a => { a.exported.baselines[0].historyLookup.medianSuccessfulSeconds = null; },
    a => { a.exported.baselines[0].people.coordinators = 0; },
    a => { a.exported.baselines[0].qualityCriterionCaptured = false; },
    a => { a.exported.baselines[0].period.endDateExclusive = '2026-11-18'; },
    a => { a.exported.baselines[0].period.timeZone = 'Etc/UTC'; },
    a => { a.exported.baselines[0].period = { startDate: '2026-11-20', endDateExclusive: '2026-11-27', timeZone: cohort.timeZone }; },
  ]) {
    const a = args(); mutate(a);
    assert.throws(() => mergePilotEnrollments(a), /invalid_application_enrollments/);
  }
});

test('fails closed on a conflicting existing scope instead of overwriting its cuts', () => {
  const a = args(); a.registry.cohorts.push({ ...cohort, code: 'old-code' });
  assert.throws(() => mergePilotEnrollments(a), /invalid_application_enrollments/);
});

test('defers concurrent confirmations after the observation cut without claiming them absent forever', () => {
  const a = args(); a.checkedAt = '2026-11-19T23:59:59.000Z';
  const result = mergePilotEnrollments(a);
  assert.equal(result.registry.cohorts.length, 0);
  assert.equal(result.baselines.length, 0);
  assert.equal(result.deferredEnrollments, 1);
});

test('accepts an explicitly declared zero median and null when all attempts failed', () => {
  const a = args(); a.exported.baselines[0].historyLookup.medianSuccessfulSeconds = 0;
  assert.equal(mergePilotEnrollments(a).baselines[0].historyLookup.medianSuccessfulSeconds, 0);
  a.exported.baselines[0].historyLookup = { attempts: 1, successful: 0, failed: 1, medianSuccessfulSeconds: null };
  assert.equal(mergePilotEnrollments(a).baselines[0].historyLookup.medianSuccessfulSeconds, null);
});

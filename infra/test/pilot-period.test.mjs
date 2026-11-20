import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollmentRecord, exportedPilotRow, normalizePilotData, pilotDates } from '../functions/domain/pilot-model.mjs';

const now = '2026-11-20T00:00:00.000Z';
const timeZone = 'America/Mexico_City';
const data = () => ({ startDate: '2026-11-20', scope: { description: 'Toda la sede', assetScope: 'all-site-assets', coordinators: 1, technicians: 0 }, goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 }, baseline: { weekStartDate: '2026-11-01', historyProtocol: 'Misma consulta', historyAttempts: [{ success: true, seconds: 15 }], effortMinutes: { preparation: 5, recording: 5, assistance: 0 }, noteUsefulnessCriterion: 'Resultado observado' } });
const prepared = () => enrollmentRecord({ scope: { orgId: 'org-a', siteId: 'north' }, actor: 'private-actor', current: { revision: 1, createdAt: now, createdBy: 'private-actor', timeZone }, data: data(), now, environment: 'production', dataClass: 'technical', agreements: { realOperation: true, authority: true, measurement: true } });

test('baseline context permits only seven complete local days before the agreement day', () => {
  const dates = pilotDates(new Date(now), timeZone);
  assert.equal(dates.latestBaselineWeekStartDate, '2026-11-12');
  const justAfterUtcMidnight = pilotDates(new Date('2026-11-20T05:59:59Z'), timeZone);
  assert.equal(justAfterUtcMidnight.latestBaselineWeekStartDate, '2026-11-12');
  const nextLocalDay = pilotDates(new Date('2026-11-20T06:00:00Z'), timeZone);
  assert.equal(nextLocalDay.latestBaselineWeekStartDate, '2026-11-13');
});

test('baseline week remains explicitly missing in drafts and is mandatory at confirmation', () => {
  const blank = data(); blank.baseline.weekStartDate = '';
  assert.equal(normalizePilotData(blank).baseline.weekStartDate, '');
  const dates = pilotDates(new Date(now), timeZone);
  assert.throws(() => normalizePilotData(blank, { complete: true, dates }), /baseline_week/);
  const absent = data(); delete absent.baseline.weekStartDate;
  assert.throws(() => normalizePilotData(absent, { complete: true, dates }), /baseline/);
  for (const weekStartDate of ['2026-11-13', '2026-11-19', '2026-11-20', '2026-12-01', '1999-12-31', '2026-02-30']) {
    const invalid = data(); invalid.baseline.weekStartDate = weekStartDate;
    assert.throws(() => normalizePilotData(invalid, { complete: true, dates }), /baseline_week/);
  }
  const boundary = data(); boundary.baseline.weekStartDate = dates.latestBaselineWeekStartDate;
  assert.equal(normalizePilotData(boundary, { complete: true, dates }).baseline.weekStartDate, '2026-11-12');
});

test('canonical baseline period derives exclusive end and site zone on the server', () => {
  const { registry } = prepared();
  assert.deepEqual(registry.baseline.period, { startDate: '2026-11-01', endDateExclusive: '2026-11-08', timeZone });
  assert.deepEqual(exportedPilotRow(registry).baseline.period, registry.baseline.period);
  const injected = data(); injected.baseline.period = { startDate: '2020-01-01', endDateExclusive: '2020-01-08', timeZone: 'UTC' };
  assert.throws(() => normalizePilotData(injected), /baseline/);
});

test('export rejects incomplete, altered-zone and future baseline weeks rather than emitting comparable-looking evidence', () => {
  const good = prepared().registry;
  const validPeriod = { startDate: '2026-11-01', endDateExclusive: '2026-11-08', timeZone };
  for (const period of [undefined, { ...validPeriod, endDateExclusive: '2026-11-07' }, { ...validPeriod, timeZone: 'UTC' }, { ...validPeriod, startDate: '2026-11-13', endDateExclusive: '2026-11-20' }]) {
    const altered = structuredClone(good); altered.baseline.period = period;
    assert.throws(() => exportedPilotRow(altered), /baseline|date/i);
  }
  const capturedTooEarly = structuredClone(good); capturedTooEarly.baseline.capturedAt = '2026-11-07T00:00:00.000Z';
  assert.throws(() => exportedPilotRow(capturedTooEarly), /baseline/i);
});

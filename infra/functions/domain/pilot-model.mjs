import { dateOnly, digest, fail, identifier, text } from './common.mjs';

export const pilotAgreementVersion = 'pilot-enrollment-v1';
export const pilotClassification = (environment, dataClass) => environment !== 'production' || dataClass === 'technical' ? 'technical' : 'enrolled-real';
const has = (value, key) => Object.hasOwn(value, key);
const object = (value, fields, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !has(value, key))) fail(400, `invalid_${name}`);
  return value;
};
const number = (value, name, min, max, complete, integer = false) => {
  if (value === null && !complete) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(400, `invalid_${name}`);
  return value;
};
const words = (value, name, max, complete) => text(value, name, max, { optional: !complete });
export const pilotRevision = value => number(value, 'expected_revision', 0, Number.MAX_SAFE_INTEGER - 1, true, true);

function localDate(now, timeZone) {
  try {
    if (typeof timeZone !== 'string' || !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(timeZone)) throw new Error();
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch { throw new Error('Invalid authorized site time zone'); }
}
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
export function pilotDates(now, timeZone) {
  const local = localDate(now, timeZone);
  return { earliestStartDate: addDays(local, 1), latestStartDate: addDays(local, 90), latestBaselineWeekStartDate: addDays(local, -7) };
}

export function normalizePilotData(input, { complete = false, dates } = {}) {
  object(input, ['startDate', 'scope', 'goals', 'baseline'], 'pilot');
  const scope = object(input.scope, ['description', 'assetScope', 'coordinators', 'technicians'], 'scope');
  const goals = object(input.goals, ['onTimeRateTarget', 'minimumDueInspections'], 'goals');
  const baseline = object(input.baseline, ['weekStartDate', 'historyProtocol', 'historyAttempts', 'effortMinutes', 'noteUsefulnessCriterion'], 'baseline');
  const effort = object(baseline.effortMinutes, ['preparation', 'recording', 'assistance'], 'effort');
  if (scope.assetScope !== 'all-site-assets') fail(400, 'invalid_asset_scope');
  if (!Array.isArray(baseline.historyAttempts) || baseline.historyAttempts.length > 30 || (complete && baseline.historyAttempts.length === 0)) fail(400, 'invalid_history_attempts');
  let startDate = input.startDate;
  if (startDate !== '' || complete) startDate = dateOnly(startDate, 'start_date');
  if (typeof startDate !== 'string') fail(400, 'invalid_start_date');
  if (complete && (!dates || startDate < dates.earliestStartDate || startDate > dates.latestStartDate)) fail(400, 'invalid_start_date');
  let weekStartDate = baseline.weekStartDate;
  if (weekStartDate !== '' || complete) weekStartDate = dateOnly(weekStartDate, 'baseline_week_start_date');
  if (typeof weekStartDate !== 'string' || (complete && (!dates?.latestBaselineWeekStartDate || weekStartDate > dates.latestBaselineWeekStartDate))) fail(400, 'invalid_baseline_week_start_date');
  return {
    startDate,
    scope: {
      description: words(scope.description, 'scope_description', 500, complete), assetScope: 'all-site-assets',
      coordinators: number(scope.coordinators, 'coordinators', 1, 1000, complete, true),
      technicians: number(scope.technicians, 'technicians', 0, 1000, complete, true),
    },
    goals: {
      onTimeRateTarget: number(goals.onTimeRateTarget, 'on_time_target', 0, 1, complete),
      minimumDueInspections: number(goals.minimumDueInspections, 'minimum_due_inspections', 1, 100000, complete, true),
    },
    baseline: {
      weekStartDate,
      historyProtocol: words(baseline.historyProtocol, 'history_protocol', 1000, complete),
      historyAttempts: baseline.historyAttempts.map(attempt => {
        object(attempt, ['success', 'seconds'], 'history_attempt');
        if (typeof attempt.success !== 'boolean' && !(attempt.success === null && !complete)) fail(400, 'invalid_history_success');
        return { success: attempt.success, seconds: number(attempt.seconds, 'history_seconds', 0, 86400, complete) };
      }),
      effortMinutes: Object.fromEntries(['preparation', 'recording', 'assistance'].map(key => [key, number(effort[key], 'effort_minutes', 0, 10080, complete)])),
      noteUsefulnessCriterion: words(baseline.noteUsefulnessCriterion, 'note_usefulness_criterion', 1000, complete),
    },
  };
}

export function pilotAgreements(value) {
  object(value, ['realOperation', 'authority', 'measurement'], 'agreements');
  if (Object.values(value).some(agreed => agreed !== true)) fail(400, 'agreements_required');
  return { realOperation: true, authority: true, measurement: true };
}

export function publicPilot(record) {
  if (!record) return null;
  return Object.fromEntries(['status', 'revision', 'startDate', 'scope', 'goals', 'baseline', 'timeZone', 'createdAt', 'updatedAt', 'code', 'classification', 'agreedAt'].filter(key => has(record, key)).map(key => [key, structuredClone(record[key])]));
}

export function enrollmentRecord({ scope, actor, current, data, now, environment, dataClass, agreements }) {
  const code = `pilot-${digest(['sedepulso-pilot-v1', scope.orgId, scope.siteId]).slice(0, 24)}`;
  const record = {
    ...data, status: 'enrolled', revision: current.revision + 1, createdAt: current.createdAt, updatedAt: now,
    timeZone: current.timeZone, code,
    classification: pilotClassification(environment, dataClass),
    agreedAt: now, confirmedBy: actor, createdBy: current.createdBy,
    confirmedFromRevision: current.revision, agreementVersion: pilotAgreementVersion, agreements,
  };
  const successfulSeconds = data.baseline.historyAttempts.filter(attempt => attempt.success).map(attempt => attempt.seconds).sort((a, b) => a - b);
  const middle = Math.floor(successfulSeconds.length / 2);
  const median = !successfulSeconds.length ? null : successfulSeconds.length % 2 ? successfulSeconds[middle] : (successfulSeconds[middle - 1] + successfulSeconds[middle]) / 2;
  const registry = {
    cohort: { code, orgId: scope.orgId, siteId: scope.siteId, timeZone: record.timeZone, startDate: data.startDate, classification: record.classification, agreedAt: now, goals: structuredClone(data.goals) },
    baseline: {
      code, capturedAt: now, source: 'participant-declared',
      period: { startDate: data.baseline.weekStartDate, endDateExclusive: addDays(data.baseline.weekStartDate, 7), timeZone: record.timeZone },
      historyLookup: { attempts: data.baseline.historyAttempts.length, successful: successfulSeconds.length, failed: data.baseline.historyAttempts.length - successfulSeconds.length, medianSuccessfulSeconds: median },
      effortMinutes: structuredClone(data.baseline.effortMinutes),
      people: { coordinators: data.scope.coordinators, technicians: data.scope.technicians },
      qualityCriterionCaptured: !!data.baseline.noteUsefulnessCriterion,
    },
  };
  return { record, registry };
}

/** Read-boundary whitelist: legacy or administrative extra columns never enter the export. */
export function exportedPilotRow(row) {
  if (!row?.cohort || !row?.baseline) throw new Error('Invalid pilot registry row');
  const { cohort, baseline } = row;
  const code = identifier(cohort.code);
  if (!/^pilot-[a-f0-9]{24}$/.test(code) || baseline.code !== code || !['technical', 'enrolled-real'].includes(cohort.classification)) throw new Error('Invalid pilot registry row');
  const goals = { onTimeRateTarget: number(cohort.goals?.onTimeRateTarget, 'on_time_target', 0, 1, true), minimumDueInspections: number(cohort.goals?.minimumDueInspections, 'minimum_due_inspections', 1, 100000, true, true) };
  const people = { coordinators: number(baseline.people?.coordinators, 'coordinators', 1, 1000, true, true), technicians: number(baseline.people?.technicians, 'technicians', 0, 1000, true, true) };
  const effortMinutes = Object.fromEntries(['preparation', 'recording', 'assistance'].map(key => [key, number(baseline.effortMinutes?.[key], 'effort_minutes', 0, 10080, true)]));
  pilotDates(new Date(), cohort.timeZone);
  const iso = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) throw new Error('Invalid pilot registry instant');
    return value;
  };
  const agreedAt = iso(cohort.agreedAt);
  const capturedAt = iso(baseline.capturedAt);
  if (!baseline.period || typeof baseline.period !== 'object' || Array.isArray(baseline.period)) throw new Error('Invalid pilot baseline period');
  const period = { startDate: dateOnly(baseline.period.startDate, 'baseline_week_start_date'), endDateExclusive: dateOnly(baseline.period.endDateExclusive, 'baseline_week_end_date'), timeZone: baseline.period.timeZone };
  if (period.timeZone !== cohort.timeZone || period.endDateExclusive !== addDays(period.startDate, 7) || period.endDateExclusive > localDate(new Date(agreedAt), cohort.timeZone) || period.endDateExclusive > localDate(new Date(capturedAt), cohort.timeZone)) throw new Error('Invalid pilot baseline period');
  const attempts = number(baseline.historyLookup?.attempts, 'history_attempts', 1, 30, true, true);
  const successful = number(baseline.historyLookup?.successful, 'history_successful', 0, attempts, true, true);
  const failed = number(baseline.historyLookup?.failed, 'history_failed', 0, attempts, true, true);
  if (successful + failed !== attempts || typeof baseline.qualityCriterionCaptured !== 'boolean' || baseline.source !== 'participant-declared') throw new Error('Invalid pilot baseline');
  const median = successful ? number(baseline.historyLookup.medianSuccessfulSeconds, 'history_median', 0, 86400, true) : null;
  if (!successful && baseline.historyLookup.medianSuccessfulSeconds !== null) throw new Error('Invalid pilot baseline');
  return {
    cohort: { code, orgId: identifier(cohort.orgId), siteId: identifier(cohort.siteId), timeZone: cohort.timeZone, startDate: dateOnly(cohort.startDate), classification: cohort.classification, agreedAt, goals },
    baseline: { code, capturedAt, source: 'participant-declared', period, historyLookup: { attempts, successful, failed, medianSuccessfulSeconds: median }, effortMinutes, people, qualityCriterionCaptured: baseline.qualityCriterionCaptured },
  };
}

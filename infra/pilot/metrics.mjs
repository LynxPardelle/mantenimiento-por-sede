const UNMEASURED = Object.freeze([
  'noteUsefulness', 'historyLookupBaseline', 'historyLookupSuccessRate',
  'historyLookupMedianSeconds', 'operationalEffortMinutes', 'awsCost', 'commercialAcceptance',
]);
const invalid = (area) => { throw new Error(`invalid_${area}`); };
const has = (value, key) => Object.hasOwn(value, key);
function fields(value, allowed, area) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some((key) => !allowed.includes(key))) invalid(area);
}
function dateOnly(value, area) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01') invalid(area);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid(area);
  return value;
}
function instant(value, area) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid(area);
  dateOnly(match[1], area);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) invalid(area);
  if (match[5] !== 'Z' && (Number(match[5].slice(1, 3)) > 23 || Number(match[5].slice(4)) > 59)) invalid(area);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) invalid(area);
  return new Date(milliseconds).toISOString();
}
function identifier(value, area) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid(area);
  return value;
}
function addDays(value, days, area = 'registry') {
  return dateOnly(new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10), area);
}
function localClock(timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return (value) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
  };
}

/** Validate an explicitly maintained private registry; activity never creates enrolment. */
export function validateRegistry(registry) {
  fields(registry, ['schemaVersion', 'cohorts'], 'registry');
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.cohorts)) invalid('registry');
  const codes = new Set();
  const scopes = new Set();
  const cohorts = registry.cohorts.map((entry) => {
    fields(entry, ['code', 'orgId', 'siteId', 'timeZone', 'startDate', 'classification', 'agreedAt', 'goals'], 'registry');
    if (typeof entry.code !== 'string' || entry.code.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.code)) invalid('registry');
    const orgId = identifier(entry.orgId, 'registry');
    const siteId = identifier(entry.siteId, 'registry');
    if (codes.has(entry.code) || scopes.has(`${orgId}/${siteId}`)) invalid('registry');
    codes.add(entry.code); scopes.add(`${orgId}/${siteId}`);
    if (!['enrolled-real', 'technical'].includes(entry.classification)) invalid('registry');
    if (typeof entry.timeZone !== 'string' || entry.timeZone.length > 100 || !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(entry.timeZone)) invalid('registry');
    let clock;
    try { clock = localClock(entry.timeZone); }
    catch { invalid('registry'); }
    const startDate = dateOnly(entry.startDate, 'registry');
    addDays(startDate, 28);
    const agreedAt = instant(entry.agreedAt, 'registry');
    // Same local start day is allowed; a later agreement cannot backdate a pilot.
    if (clock(agreedAt).date > startDate) invalid('registry');
    fields(entry.goals, ['onTimeRateTarget', 'minimumDueInspections'], 'registry');
    if (!Number.isFinite(entry.goals.onTimeRateTarget) || entry.goals.onTimeRateTarget < 0 || entry.goals.onTimeRateTarget > 1 || !Number.isInteger(entry.goals.minimumDueInspections) || entry.goals.minimumDueInspections < 1) invalid('registry');
    return { code: entry.code, orgId, siteId, timeZone: entry.timeZone, startDate, classification: entry.classification, agreedAt, goals: { ...entry.goals } };
  });
  return { schemaVersion: 1, cohorts };
}

function validateObservations(observations, cohorts) {
  if (!Array.isArray(observations)) invalid('observations');
  const allowedCodes = new Set(cohorts.map(({ code }) => code));
  const byCode = new Map();
  for (const observation of observations) {
    fields(observation, ['code', 'assets', 'inspections'], 'observations');
    if (!allowedCodes.has(observation.code) || byCode.has(observation.code) || !Array.isArray(observation.assets) || !Array.isArray(observation.inspections)) invalid('observations');
    const assets = new Map();
    for (const asset of observation.assets) {
      fields(asset, ['id', 'status', 'createdAt'], 'observations');
      identifier(asset.id, 'observations');
      if (assets.has(asset.id) || !['operational', 'out_of_service'].includes(asset.status)) invalid('observations');
      assets.set(asset.id, { id: asset.id, status: asset.status, ...(has(asset, 'createdAt') ? { createdAt: instant(asset.createdAt, 'observations') } : {}) });
    }
    const inspections = new Map();
    for (const inspection of observation.inspections) {
      fields(inspection, ['id', 'assetId', 'dueDate', 'status', 'result', 'completedAt', 'createdAt', 'hasNote', 'hasAuthor'], 'observations');
      identifier(inspection.id, 'observations');
      identifier(inspection.assetId, 'observations');
      if (inspections.has(inspection.id) || !assets.has(inspection.assetId) || !['pending', 'completed'].includes(inspection.status) || typeof inspection.hasNote !== 'boolean' || typeof inspection.hasAuthor !== 'boolean') invalid('observations');
      if (has(inspection, 'result') && !['ok', 'attention', 'failed'].includes(inspection.result)) invalid('observations');
      if (inspection.status === 'pending' && (has(inspection, 'result') || has(inspection, 'completedAt'))) invalid('observations');
      const item = { id: inspection.id, assetId: inspection.assetId, dueDate: dateOnly(inspection.dueDate, 'observations'), status: inspection.status, hasNote: inspection.hasNote, hasAuthor: inspection.hasAuthor };
      if (has(inspection, 'result')) item.result = inspection.result;
      if (has(inspection, 'completedAt')) item.completedAt = instant(inspection.completedAt, 'observations');
      if (has(inspection, 'createdAt')) item.createdAt = instant(inspection.createdAt, 'observations');
      if (item.createdAt && item.completedAt && item.createdAt > item.completedAt) invalid('observations');
      inspections.set(item.id, item);
    }
    byCode.set(observation.code, { assets: [...assets.values()], inspections: [...inspections.values()] });
  }
  return byCode;
}

const ratio = (numerator = null, denominator = null) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });
function summarizeCohort(cohort, observation, checkedAt) {
  const clock = localClock(cohort.timeZone);
  const boundaryCache = new Map();
  function midnight(date) {
    if (boundaryCache.has(date)) return boundaryCache.get(date);
    // Search by local calendar date, so DST shifts (including midnight shifts)
    // do not assume that a local day is 24 elapsed hours.
    const utc = Date.parse(`${date}T00:00:00Z`);
    let low = utc - 36 * 3600000;
    let high = utc + 36 * 3600000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (clock(middle).date < date) low = middle + 1;
      else high = middle;
    }
    if (clock(low).date !== date) invalid('registry');
    const value = new Date(low).toISOString();
    boundaryCache.set(date, value);
    return value;
  }
  const weeks = Array.from({ length: 4 }, (_, index) => {
    const startDate = addDays(cohort.startDate, index * 7);
    const endDateExclusive = addDays(startDate, 7);
    const startUtc = midnight(startDate);
    const endUtc = midnight(endDateExclusive);
    const status = checkedAt < startUtc ? 'future' : checkedAt >= endUtc ? 'closed' : 'in-progress';
    const cutoffUtc = status === 'future' ? null : status === 'closed' ? endUtc : checkedAt;
    const cutoffClock = cutoffUtc ? clock(cutoffUtc) : null;
    const base = {
      week: index + 1, startDate, endDateExclusive, startUtc, endUtc, status, cutoffUtc,
      cutoffLocalDate: cutoffClock?.date ?? null, cutoffLocalTime: cutoffClock?.time ?? null,
      cutoffExclusive: status === 'closed',
    };
    const coverage = { observationMissing: !observation, legacyMissingCreatedAt: null, historicalCompleteness: 'not-observed', inspectionsCreatedAfterCutoff: null, completedWithoutTimestamp: null };
    if (status === 'future' || !observation) return { ...base, onTime: ratio(), closedInPeriod: null, structuralEvidence: ratio(), results: null, priorBacklog: null, inventory: null, coverage };
    const before = (time) => status === 'closed' ? time < cutoffUtc : time <= cutoffUtc;
    const exists = (item) => !item.createdAt || before(item.createdAt);
    const assets = observation.assets.filter(exists);
    const inspections = observation.inspections.filter(exists);
    const completed = (item) => item.status === 'completed' && item.completedAt && before(item.completedAt);
    const due = inspections.filter(({ dueDate }) => dueDate >= startDate && dueDate < endDateExclusive);
    const onTime = due.filter((item) => completed(item) && clock(item.completedAt).date <= item.dueDate);
    const closes = inspections.filter((item) => completed(item) && item.completedAt >= startUtc);
    const structural = closes.filter((item) => item.result && item.hasNote && item.hasAuthor && item.completedAt);
    const results = { ok: 0, attention: 0, failed: 0 };
    for (const item of closes) if (item.result) results[item.result]++;
    const legacyMissingCreatedAt = { assets: assets.filter((item) => !item.createdAt).length, inspections: inspections.filter((item) => !item.createdAt).length };
    return {
      ...base, onTime: ratio(onTime.length, due.length), closedInPeriod: closes.length,
      structuralEvidence: ratio(structural.length, closes.length), results,
      priorBacklog: inspections.filter((item) => item.dueDate < startDate && !completed(item)).length,
      inventory: { total: assets.length, operational: assets.filter(({ status: assetStatus }) => assetStatus === 'operational').length, outOfService: assets.filter(({ status: assetStatus }) => assetStatus === 'out_of_service').length },
      coverage: {
        observationMissing: false, legacyMissingCreatedAt,
        historicalCompleteness: legacyMissingCreatedAt.assets || legacyMissingCreatedAt.inspections ? 'limited' : 'known-created-at',
        inspectionsCreatedAfterCutoff: observation.inspections.length - inspections.length,
        completedWithoutTimestamp: inspections.filter((item) => item.status === 'completed' && !item.completedAt).length,
      },
    };
  });
  const current = weeks.find(({ status }) => status === 'in-progress');
  const status = current ? 'collecting' : weeks.every((week) => week.status === 'future') ? 'awaiting-start' : 'observation-window-ended';
  return {
    code: cohort.code, classification: cohort.classification, timeZone: cohort.timeZone, startDate: cohort.startDate,
    status, pilotWeek: current?.week ?? (status === 'observation-window-ended' ? 4 : null),
    goals: { ...cohort.goals }, weeks, unmeasured: [...UNMEASURED],
  };
}

/** Rebuild totals from report windows after immutable weekly snapshots are restored. */
export function aggregatePilotTotals(reports) {
  if (!Array.isArray(reports)) invalid('reports');
  const totals = {};
  for (const classification of ['enrolled-real', 'technical']) {
    const selected = reports.filter((entry) => entry.classification === classification);
    const measured = selected.flatMap(({ weeks }) => weeks).filter(({ onTime }) => onTime.denominator !== null);
    const sum = (metric, field) => measured.reduce((total, week) => total + week[metric][field], 0);
    totals[classification] = {
      cohorts: selected.length, observedWeekWindows: measured.length,
      onTime: measured.length ? ratio(sum('onTime', 'numerator'), sum('onTime', 'denominator')) : ratio(),
      structuralEvidence: measured.length ? ratio(sum('structuralEvidence', 'numerator'), sum('structuralEvidence', 'denominator')) : ratio(),
      closedInPeriod: measured.length ? measured.reduce((total, week) => total + week.closedInPeriod, 0) : null,
      missingObservationCohorts: selected.filter(({ weeks }) => weeks.every(({ coverage }) => coverage.observationMissing)).length,
    };
  }
  return totals;
}

/** Pure aggregate report: no tenant, asset, inspection, person or evidence text leaves this boundary. */
export function summarizePilot({ cohorts, observations, checkedAt }) {
  const registry = validateRegistry({ schemaVersion: 1, cohorts });
  const cutoff = instant(checkedAt, 'cutoff');
  if (registry.cohorts.some(({ agreedAt }) => agreedAt > cutoff)) invalid('registry');
  const byCode = validateObservations(observations, registry.cohorts);
  const reports = registry.cohorts.map((cohort) => summarizeCohort(cohort, byCode.get(cohort.code), cutoff));
  const real = reports.filter(({ classification }) => classification === 'enrolled-real');
  const status = !real.length ? 'awaiting-participant' : real.some((entry) => entry.status === 'collecting') ? 'collecting' : real.every((entry) => entry.status === 'awaiting-start') ? 'awaiting-start' : real.every((entry) => entry.status === 'observation-window-ended') ? 'observation-window-ended' : 'mixed-windows';
  const weekValues = new Set(real.map(({ pilotWeek }) => pilotWeek));
  return { schemaVersion: 1, checkedAt: cutoff, status, pilotWeek: real.length && weekValues.size === 1 ? real[0].pilotWeek : null, cohorts: reports, totals: aggregatePilotTotals(reports), unmeasured: [...UNMEASURED] };
}

import { validateRegistry } from './metrics.mjs';

const invalid = () => { throw new Error('invalid_application_enrollments'); };
function fields(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !names.includes(k)) || names.some(k => !Object.hasOwn(value, k))) invalid();
}
const finite = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
const integer = (n, max) => Number.isInteger(n) && finite(n, max);
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '2000-01-01' && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

/** Merge only the owner service's whitelisted export; free-text enrollment data stays in Pilot. */
export function mergePilotEnrollments({ registry, exported, checkedAt }) {
  try {
    if (!instant(checkedAt)) invalid();
    const administrative = validateRegistry(registry);
    fields(exported, ['schemaVersion', 'cohorts', 'baselines']);
    if (exported.schemaVersion !== 1 || !Array.isArray(exported.baselines)) invalid();
    const application = validateRegistry({ schemaVersion: 1, cohorts: exported.cohorts });
    // Fail closed on conflicts rather than relabel or overwrite an established cohort.
    validateRegistry({ schemaVersion: 1, cohorts: [...administrative.cohorts, ...application.cohorts] });
    const cohortsByCode = new Map(application.cohorts.map(c => [c.code, c]));
    const seen = new Set();
    for (const b of exported.baselines) {
      fields(b, ['code', 'capturedAt', 'source', 'period', 'historyLookup', 'effortMinutes', 'people', 'qualityCriterionCaptured']);
      if (!cohortsByCode.has(b.code) || seen.has(b.code) || !instant(b.capturedAt) || b.source !== 'participant-declared' || b.qualityCriterionCaptured !== true) invalid();
      seen.add(b.code);
      fields(b.period, ['startDate', 'endDateExclusive', 'timeZone']);
      const p = b.period;
      const localCaptureDate = new Intl.DateTimeFormat('en-CA', { timeZone: cohortsByCode.get(b.code).timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(b.capturedAt));
      if (p.timeZone !== cohortsByCode.get(b.code).timeZone || !day(p.startDate) || !day(p.endDateExclusive) || new Date(Date.parse(p.startDate + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10) !== p.endDateExclusive || p.endDateExclusive > localCaptureDate) invalid();
      fields(b.historyLookup, ['attempts', 'successful', 'failed', 'medianSuccessfulSeconds']);
      const h = b.historyLookup;
      if (!integer(h.attempts, 30) || h.attempts < 1 || !integer(h.successful, 30) || !integer(h.failed, 30) || h.successful + h.failed !== h.attempts || (h.successful === 0 ? h.medianSuccessfulSeconds !== null : !finite(h.medianSuccessfulSeconds, 86400))) invalid();
      fields(b.effortMinutes, ['preparation', 'recording', 'assistance']);
      if (Object.values(b.effortMinutes).some(n => !finite(n, 10080))) invalid();
      fields(b.people, ['coordinators', 'technicians']);
      if (!integer(b.people.coordinators, 1000) || b.people.coordinators < 1 || !integer(b.people.technicians, 1000)) invalid();
    }
    if (seen.size !== application.cohorts.length) invalid();
    const eligible = application.cohorts.filter(c => c.agreedAt <= checkedAt && exported.baselines.find(b => b.code === c.code).capturedAt <= checkedAt);
    return {
      registry: { schemaVersion: 1, cohorts: [...administrative.cohorts, ...eligible] },
      baselines: structuredClone(exported.baselines.filter(b => eligible.some(c => c.code === b.code))),
      deferredEnrollments: application.cohorts.length - eligible.length,
    };
  } catch { invalid(); }
}

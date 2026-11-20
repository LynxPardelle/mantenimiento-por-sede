import { PilotContext, PilotEnrollment } from './pilot.models';

const unavailable = (): never => {
  throw new Error('pilot_response_unavailable');
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const classification = (value: unknown) => value === 'technical' || value === 'enrolled-real';
const calendarDate = (value: unknown, empty = false): value is string => {
  if (empty && value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01')
    return false;
  const milliseconds = Date.parse(value + 'T00:00:00Z');
  return (
    Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value
  );
};
const timeZone = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.length > 100 ||
    !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(value)
  )
    return false;
  try {
    new Intl.DateTimeFormat('es-MX', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
};
const text = (value: unknown, maximum: number, complete: boolean) =>
  typeof value === 'string' && value.length <= maximum && (!complete || value.trim().length > 0);
const numeric = (
  value: unknown,
  minimum: number,
  maximum: number,
  integer: boolean,
  complete: boolean,
) =>
  value === null
    ? !complete
    : typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= minimum &&
      value <= maximum &&
      (!integer || Number.isInteger(value));

export function pilotEnrollmentResponse(value: unknown): PilotEnrollment {
  if (
    !object(value) ||
    !['draft', 'enrolled'].includes(String(value['status'])) ||
    !Number.isSafeInteger(value['revision']) ||
    Number(value['revision']) < 1
  )
    return unavailable();
  const complete = value['status'] === 'enrolled';
  const scope = value['scope'];
  const goals = value['goals'];
  const baseline = value['baseline'];
  if (
    !calendarDate(value['startDate'], !complete) ||
    !object(scope) ||
    !object(goals) ||
    !object(baseline)
  )
    return unavailable();
  if (
    !text(scope['description'], 500, complete) ||
    scope['assetScope'] !== 'all-site-assets' ||
    !numeric(scope['coordinators'], 1, 1000, true, complete) ||
    !numeric(scope['technicians'], 0, 1000, true, complete)
  )
    return unavailable();
  if (
    !numeric(goals['onTimeRateTarget'], 0, 1, false, complete) ||
    !numeric(goals['minimumDueInspections'], 1, 100000, true, complete)
  )
    return unavailable();
  if (
    !calendarDate(baseline['weekStartDate'], !complete) ||
    !text(baseline['historyProtocol'], 1000, complete) ||
    !text(baseline['noteUsefulnessCriterion'], 1000, complete)
  )
    return unavailable();
  const attempts = baseline['historyAttempts'];
  const effort = baseline['effortMinutes'];
  if (
    !Array.isArray(attempts) ||
    attempts.length > 30 ||
    (complete && !attempts.length) ||
    !object(effort)
  )
    return unavailable();
  if (
    attempts.some(
      (attempt) =>
        !object(attempt) ||
        !(typeof attempt['success'] === 'boolean' || (!complete && attempt['success'] === null)) ||
        !numeric(attempt['seconds'], 0, 86400, false, complete),
    )
  )
    return unavailable();
  if (
    !['preparation', 'recording', 'assistance'].every((key) =>
      numeric(effort[key], 0, 10080, false, complete),
    )
  )
    return unavailable();
  if (
    complete &&
    (!classification(value['classification']) ||
      typeof value['code'] !== 'string' ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value['code']) ||
      value['code'].length > 64 ||
      typeof value['agreedAt'] !== 'string' ||
      !Number.isFinite(Date.parse(value['agreedAt'])))
  )
    return unavailable();
  return value as unknown as PilotEnrollment;
}

export function pilotContextResponse(value: unknown, expectedSite: string): PilotContext {
  if (!object(value) || !object(value['site'])) return unavailable();
  const site = value['site'];
  if (
    site['id'] !== expectedSite ||
    site['role'] !== 'coordinator' ||
    !text(site['name'], 120, true) ||
    !timeZone(site['timeZone']) ||
    !classification(value['classification'])
  )
    return unavailable();
  if (
    !calendarDate(value['earliestStartDate']) ||
    !calendarDate(value['latestStartDate']) ||
    !calendarDate(value['latestBaselineWeekStartDate']) ||
    value['earliestStartDate'] > value['latestStartDate'] ||
    value['latestBaselineWeekStartDate'] >= value['earliestStartDate']
  )
    return unavailable();
  if (value['enrollment'] !== null) pilotEnrollmentResponse(value['enrollment']);
  return value as unknown as PilotContext;
}

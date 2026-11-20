import { pilotEnrollmentResponse } from '../pilot/pilot.response';
import {
  ReviewComparison,
  ReviewPeriod,
  ReviewsContext,
  WeeklyReview,
} from './pilot-reviews.models';

const unavailable = (): never => {
  throw new Error('pilot_review_response_unavailable');
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number, nullable = false, integer = false) =>
  v === null
    ? nullable
    : typeof v === 'number' &&
      Number.isFinite(v) &&
      v >= min &&
      v <= max &&
      (!integer || Number.isInteger(v));
const instant = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const date = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  v >= '2000-01-01' &&
  Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
  new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const addDays = (v: string, days: number) =>
  new Date(Date.parse(v + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const timeZone = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(v))
    return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: v }).format(new Date());
    return true;
  } catch {
    return false;
  }
};
const text = (v: unknown, complete = false) =>
  typeof v === 'string' && v.length <= 1000 && (!complete || !!v.trim());
function periodResponse(v: unknown): ReviewPeriod {
  if (
    !object(v) ||
    !date(v['startDate']) ||
    !date(v['endDateExclusive']) ||
    !timeZone(v['timeZone']) ||
    addDays(v['startDate'], 7) !== v['endDateExclusive']
  )
    return unavailable();
  return v as unknown as ReviewPeriod;
}
const localDate = (v: string, zone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(v));

export function weeklyReviewResponse(v: unknown, expectedWeek: number): WeeklyReview {
  if (
    !object(v) ||
    !number(v['week'], 1, 4, false, true) ||
    v['week'] !== expectedWeek ||
    !['draft', 'confirmed'].includes(String(v['status'])) ||
    !number(v['revision'], 1, Number.MAX_SAFE_INTEGER, false, true) ||
    !instant(v['createdAt']) ||
    !instant(v['updatedAt'])
  )
    return unavailable();
  const period = periodResponse(v['period']);
  const complete = v['status'] === 'confirmed';
  if (
    !text(v['summary'], complete) ||
    !text(v['nextAction'], complete) ||
    !(v['sameProtocol'] === null || typeof v['sameProtocol'] === 'boolean')
  )
    return unavailable();
  const attempts = v['historyAttempts'];
  const effort = v['effortMinutes'];
  const notes = v['noteAssessment'];
  if (!Array.isArray(attempts) || attempts.length > 30 || !object(effort) || !object(notes))
    return unavailable();
  if (
    attempts.some(
      (a) =>
        !object(a) ||
        !(typeof a['success'] === 'boolean' || (!complete && a['success'] === null)) ||
        !number(a['seconds'], 0, 86400, !complete),
    )
  )
    return unavailable();
  if (
    ['preparation', 'recording', 'assistance'].some((key) => !number(effort[key], 0, 10080, true))
  )
    return unavailable();
  if (
    !number(notes['reviewed'], 0, 100000, true, true) ||
    !number(notes['useful'], 0, 100000, true, true) ||
    (typeof notes['reviewed'] === 'number' &&
      typeof notes['useful'] === 'number' &&
      notes['useful'] > notes['reviewed']) ||
    (complete && (notes['reviewed'] === null) !== (notes['useful'] === null))
  )
    return unavailable();
  if (
    complete &&
    (!instant(v['confirmedAt']) ||
      localDate(v['confirmedAt'], period.timeZone) < period.endDateExclusive)
  )
    return unavailable();
  return v as unknown as WeeklyReview;
}
function comparisonResponse(v: unknown): ReviewComparison {
  if (
    !object(v) ||
    typeof v['comparable'] !== 'boolean' ||
    !['same-protocol', 'different-protocol', 'not-attested'].includes(String(v['reason'])) ||
    v['comparable'] !== (v['reason'] === 'same-protocol')
  )
    return unavailable();
  const history = v['history'];
  const effort = v['effortMinutes'];
  const notes = v['noteUsefulness'];
  if (!object(history) || !object(effort) || !object(notes)) return unavailable();
  if (
    !number(history['baselineMedianSeconds'], 0, 86400, true) ||
    !number(history['reviewMedianSeconds'], 0, 86400, true) ||
    !number(history['deltaSeconds'], -86400, 86400, true) ||
    !number(history['changePercent'], -Number.MAX_VALUE, Number.MAX_VALUE, true) ||
    !number(history['baselineSuccessRate'], 0, 1) ||
    !number(history['reviewSuccessRate'], 0, 1, true) ||
    !number(history['successRateDeltaPoints'], -100, 100, true)
  )
    return unavailable();
  if (
    !v['comparable'] &&
    ['deltaSeconds', 'changePercent', 'successRateDeltaPoints'].some((key) => history[key] !== null)
  )
    return unavailable();
  for (const key of ['preparation', 'recording', 'assistance', 'total']) {
    const value = effort[key];
    const max = key === 'total' ? 30240 : 10080;
    if (
      !object(value) ||
      !number(value['baseline'], 0, max) ||
      !number(value['review'], 0, max, true) ||
      !number(value['delta'], -max, max, true) ||
      (!v['comparable'] && value['delta'] !== null)
    )
      return unavailable();
  }
  if (
    !number(notes['reviewed'], 0, 100000, true, true) ||
    !number(notes['useful'], 0, 100000, true, true) ||
    !number(notes['rate'], 0, 1, true) ||
    (notes['reviewed'] === null) !== (notes['useful'] === null) ||
    (typeof notes['reviewed'] === 'number' &&
      typeof notes['useful'] === 'number' &&
      notes['useful'] > notes['reviewed'])
  )
    return unavailable();
  return v as unknown as ReviewComparison;
}
export function reviewContextResponse(v: unknown, expectedSite: string): ReviewsContext {
  if (!object(v) || !object(v['site']) || !instant(v['checkedAt']) || !Array.isArray(v['weeks']))
    return unavailable();
  const site = v['site'];
  if (
    site['id'] !== expectedSite ||
    site['role'] !== 'coordinator' ||
    typeof site['name'] !== 'string' ||
    !site['name'].trim() ||
    !timeZone(site['timeZone'])
  )
    return unavailable();
  let enrollment;
  try {
    enrollment = v['enrollment'] === null ? null : pilotEnrollmentResponse(v['enrollment']);
  } catch {
    return unavailable();
  }
  if (enrollment?.status !== 'enrolled') {
    if (v['weeks'].length !== 0) return unavailable();
    return v as unknown as ReviewsContext;
  }
  if (v['weeks'].length !== 4) return unavailable();
  const enrollmentZone = object(v['enrollment'])
    ? (v['enrollment']['timeZone'] ?? site['timeZone'])
    : site['timeZone'];
  if (!timeZone(enrollmentZone)) return unavailable();
  const today = localDate(v['checkedAt'], enrollmentZone);
  for (const [i, week] of v['weeks'].entries()) {
    if (!object(week) || week['week'] !== i + 1) return unavailable();
    const period = periodResponse(week['period']);
    if (
      period.startDate !== addDays(enrollment.startDate, i * 7) ||
      period.timeZone !== enrollmentZone ||
      week['status'] !==
        (today < period.startDate ? 'future' : today < period.endDateExclusive ? 'open' : 'closed')
    )
      return unavailable();
    if (week['review'] !== null) {
      const review = weeklyReviewResponse(week['review'], i + 1);
      if (
        review.period.startDate !== period.startDate ||
        review.period.endDateExclusive !== period.endDateExclusive ||
        review.period.timeZone !== period.timeZone ||
        (review.status === 'confirmed' && week['status'] !== 'closed')
      )
        return unavailable();
      if (review.status === 'confirmed') comparisonResponse(week['comparison']);
      else if (week['comparison'] !== null) return unavailable();
    } else if (week['comparison'] !== null) return unavailable();
  }
  return v as unknown as ReviewsContext;
}

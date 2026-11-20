import { dateOnly } from './common.mjs';

const invalid = () => {
  throw new Error('Invalid pilot review export');
};
const dayAdd = (day, days) =>
  new Date(Date.parse(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const dayAt = (now, timeZone) => {
  if (typeof timeZone !== 'string' || !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(timeZone))
    invalid();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
};
const measured = (n, max = 10080, integer = false) =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max && (!integer || Number.isInteger(n));
const nullable = (n, max, integer) => n === null || measured(n, max, integer);
const keys = ['preparation', 'recording', 'assistance'];
export function reviewPeriod(enrollment, week, now) {
  if (!Number.isInteger(week) || week < 1 || week > 4) invalid();
  const startDate = dayAdd(dateOnly(enrollment.startDate), 7 * (week - 1));
  const endDateExclusive = dayAdd(startDate, 7);
  const today = dayAt(now, enrollment.timeZone);
  return {
    week,
    period: { startDate, endDateExclusive, timeZone: enrollment.timeZone },
    status: today < startDate ? 'future' : today < endDateExclusive ? 'open' : 'closed',
  };
}
export function summarizeReview(record, code) {
  const successful = record.historyAttempts
    .filter((a) => a.success)
    .map((a) => a.seconds)
    .sort((a, b) => a - b);
  const middle = Math.floor(successful.length / 2);
  return {
    code,
    week: record.week,
    capturedAt: record.confirmedAt,
    source: 'participant-declared',
    period: structuredClone(record.period),
    sameProtocol: record.sameProtocol,
    historyLookup: {
      attempts: record.historyAttempts.length,
      successful: successful.length,
      failed: record.historyAttempts.length - successful.length,
      medianSuccessfulSeconds: successful.length
        ? successful.length % 2
          ? successful[middle]
          : (successful[middle - 1] + successful[middle]) / 2
        : null,
    },
    effortMinutes: structuredClone(record.effortMinutes),
    noteAssessment: {
      ...record.noteAssessment,
      usefulRate:
        record.noteAssessment.reviewed > 0
          ? record.noteAssessment.useful / record.noteAssessment.reviewed
          : null,
    },
  };
}
export function compareReview(baseline, review) {
  const comparable = review.sameProtocol === true;
  const delta = (a, b) => (comparable && a !== null && b !== null ? b - a : null);
  const b = baseline.historyLookup,
    r = review.historyLookup;
  const baselineSuccessRate = b.attempts > 0 ? b.successful / b.attempts : null;
  const reviewSuccessRate = r.attempts > 0 ? r.successful / r.attempts : null;
  const deltaSeconds = delta(b.medianSuccessfulSeconds, r.medianSuccessfulSeconds);
  const total = (effort) =>
    keys.every((key) => effort[key] !== null) ? keys.reduce((n, key) => n + effort[key], 0) : null;
  const effortMinutes = Object.fromEntries(
    [...keys, 'total'].map((key) => {
      const a = key === 'total' ? total(baseline.effortMinutes) : baseline.effortMinutes[key];
      const v = key === 'total' ? total(review.effortMinutes) : review.effortMinutes[key];
      return [key, { baseline: a, review: v, delta: delta(a, v) }];
    }),
  );
  return {
    comparable,
    reason: comparable
      ? 'same-protocol'
      : review.sameProtocol === false
        ? 'different-protocol'
        : 'not-attested',
    history: {
      baselineMedianSeconds: b.medianSuccessfulSeconds,
      reviewMedianSeconds: r.medianSuccessfulSeconds,
      deltaSeconds,
      changePercent:
        deltaSeconds !== null && b.medianSuccessfulSeconds > 0
          ? (deltaSeconds / b.medianSuccessfulSeconds) * 100
          : null,
      baselineSuccessRate,
      reviewSuccessRate,
      successRateDeltaPoints:
        comparable && baselineSuccessRate !== null && reviewSuccessRate !== null
          ? (reviewSuccessRate - baselineSuccessRate) * 100
          : null,
    },
    effortMinutes,
    noteUsefulness: {
      reviewed: review.noteAssessment.reviewed,
      useful: review.noteAssessment.useful,
      rate: review.noteAssessment.usefulRate,
    },
  };
}
/** Whitelist a confirmed aggregate, including legacy table rows with unrelated private columns. */
export function exportedReview(value, cohort) {
  try {
    if (
      !value ||
      value.code !== cohort.code ||
      value.source !== 'participant-declared' ||
      ![null, true, false].includes(value.sameProtocol)
    )
      invalid();
    const capturedAt = value.capturedAt;
    if (
      typeof capturedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capturedAt) ||
      new Date(capturedAt).toISOString() !== capturedAt ||
      capturedAt < cohort.agreedAt
    )
      invalid();
    const window = reviewPeriod(cohort, value.week, new Date(capturedAt));
    if (
      window.status !== 'closed' ||
      !value.period ||
      Object.keys(window.period).some((key) => window.period[key] !== value.period[key])
    )
      invalid();
    const h = value.historyLookup;
    if (
      !h ||
      !measured(h.attempts, 30, true) ||
      !measured(h.successful, 30, true) ||
      !measured(h.failed, 30, true) ||
      h.successful + h.failed !== h.attempts ||
      (h.successful ? !measured(h.medianSuccessfulSeconds, 86400) : h.medianSuccessfulSeconds !== null)
    )
      invalid();
    const effortMinutes = Object.fromEntries(
      keys.map((key) => {
        const n = value.effortMinutes?.[key];
        if (!nullable(n, 10080)) invalid();
        return [key, n];
      }),
    );
    const n = value.noteAssessment;
    if (
      !n ||
      !nullable(n.reviewed, 100000, true) ||
      !nullable(n.useful, 100000, true) ||
      (n.reviewed === null) !== (n.useful === null) ||
      (n.reviewed !== null && n.useful > n.reviewed) ||
      n.usefulRate !== (n.reviewed > 0 ? n.useful / n.reviewed : null)
    )
      invalid();
    return {
      code: cohort.code,
      week: value.week,
      capturedAt,
      source: 'participant-declared',
      period: window.period,
      historyLookup: {
        attempts: h.attempts,
        successful: h.successful,
        failed: h.failed,
        medianSuccessfulSeconds: h.medianSuccessfulSeconds,
      },
      effortMinutes,
      noteAssessment: { reviewed: n.reviewed, useful: n.useful, usefulRate: n.usefulRate },
      sameProtocol: value.sameProtocol,
    };
  } catch {
    invalid();
  }
}

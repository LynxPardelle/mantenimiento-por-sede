import { fail, text } from './common.mjs';
export const reviewFields = [
  'sameProtocol',
  'historyAttempts',
  'effortMinutes',
  'noteAssessment',
  'summary',
  'nextAction',
];
const object = (v, fields) => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    fields.some((k) => !Object.hasOwn(v, k)) ||
    Object.keys(v).some((k) => !fields.includes(k))
  )
    fail(400, 'invalid_review');
  return v;
};
const number = (v, max, integer = false) => {
  if (
    v !== null &&
    (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max || (integer && !Number.isInteger(v)))
  )
    fail(400, 'invalid_review_measurement');
  return v;
};
export function normalizeReview(input, { complete = false } = {}) {
  object(input, reviewFields);
  object(input.effortMinutes, ['preparation', 'recording', 'assistance']);
  object(input.noteAssessment, ['reviewed', 'useful']);
  if (
    ![true, false, null].includes(input.sameProtocol) ||
    !Array.isArray(input.historyAttempts) ||
    input.historyAttempts.length > 30
  )
    fail(400, 'invalid_review');
  const historyAttempts = input.historyAttempts.map((a) => {
    object(a, ['success', 'seconds']);
    if (![true, false, null].includes(a.success) || (complete && (a.success === null || a.seconds === null)))
      fail(400, 'invalid_review_attempt');
    return { success: a.success, seconds: number(a.seconds, 86400) };
  });
  const noteAssessment = {
    reviewed: number(input.noteAssessment.reviewed, 100000, true),
    useful: number(input.noteAssessment.useful, 100000, true),
  };
  if (
    noteAssessment.reviewed !== null &&
    noteAssessment.useful !== null &&
    noteAssessment.useful > noteAssessment.reviewed
  )
    fail(400, 'invalid_review_notes');
  if (complete && (noteAssessment.reviewed === null) !== (noteAssessment.useful === null))
    fail(400, 'invalid_review_notes');
  return {
    sameProtocol: input.sameProtocol,
    historyAttempts,
    effortMinutes: Object.fromEntries(
      ['preparation', 'recording', 'assistance'].map((k) => [k, number(input.effortMinutes[k], 10080)]),
    ),
    noteAssessment,
    summary: text(input.summary, 'review_summary', 1000, { optional: !complete }),
    nextAction: text(input.nextAction, 'review_next_action', 1000, { optional: !complete }),
  };
}
export function publicReview(record) {
  if (!record) return null;
  return Object.fromEntries(
    [...reviewFields, 'week', 'period', 'status', 'revision', 'createdAt', 'updatedAt', 'confirmedAt']
      .filter((k) => Object.hasOwn(record, k))
      .map((k) => [k, structuredClone(record[k])]),
  );
}

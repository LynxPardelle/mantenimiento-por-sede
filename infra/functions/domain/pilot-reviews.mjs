import { fail, jsonBody, response } from './common.mjs';
import { enrollmentRecord, publicPilot, pilotRevision } from './pilot-model.mjs';
import { normalizeReview, publicReview, reviewFields } from './pilot-review-model.mjs';
import { compareReview, reviewPeriod, summarizeReview } from './pilot-review-metrics.mjs';

function baselineOf(enrollment, scope) {
  return enrollmentRecord({
    scope,
    actor: '',
    current: enrollment,
    data: enrollment,
    now: enrollment.agreedAt,
    environment: 'production',
    dataClass: enrollment.classification === 'technical' ? 'technical' : 'unclassified',
    agreements: enrollment.agreements,
  }).registry.baseline;
}
export async function pilotReviews({
  event,
  method,
  suffix,
  scope,
  authorization,
  identity,
  repository,
  now,
}) {
  const enrollment = await repository.get(scope);
  if (method === 'GET' && suffix === '/reviews') {
    const { id, name, timeZone, role } = authorization.site;
    const weeks = [];
    if (enrollment?.status === 'enrolled') {
      const baseline = baselineOf(enrollment, scope);
      for (let week = 1; week <= 4; week++) {
        const window = reviewPeriod(enrollment, week, now);
        const record = await repository.getReview(scope, week);
        if (
          record &&
          (record.code !== enrollment.code ||
            record.week !== week ||
            Object.keys(window.period).some((key) => record.period?.[key] !== window.period[key]))
        )
          throw new Error('Review scope mismatch');
        weeks.push({
          ...window,
          review: publicReview(record),
          comparison:
            record?.status === 'confirmed'
              ? compareReview(baseline, summarizeReview(record, enrollment.code))
              : null,
        });
      }
    }
    return response(200, {
      site: { id, name, timeZone, role },
      enrollment: publicPilot(enrollment),
      checkedAt: now.toISOString(),
      weeks,
    });
  }
  const match = /^\/reviews\/([1-4])(\/confirmation)?$/.exec(suffix);
  if (!match) fail(405, 'method_not_allowed');
  if (!enrollment || enrollment.status !== 'enrolled') fail(409, 'pilot_enrollment_required');
  if (enrollment.timeZone !== authorization.site.timeZone) fail(409, 'pilot_site_context_changed');
  const week = Number(match[1]);
  const window = reviewPeriod(enrollment, week, now);
  if (method === 'PUT' && !match[2]) {
    if (window.status === 'future') fail(409, 'pilot_review_not_started');
    const body = jsonBody(event, ['expectedRevision', ...reviewFields]);
    const expectedRevision = pilotRevision(body.expectedRevision);
    const { expectedRevision: ignored, ...fields } = body;
    const data = normalizeReview(fields);
    return response(
      200,
      publicReview(
        await repository.saveReviewDraft({
          scope,
          enrollment,
          week,
          period: window.period,
          actor: identity.sub,
          expectedRevision,
          data,
          now: now.toISOString(),
        }),
      ),
    );
  }
  if (method !== 'POST' || !match[2]) fail(405, 'method_not_allowed');
  const body = jsonBody(event, ['expectedRevision', 'attested']);
  const expectedRevision = pilotRevision(body.expectedRevision);
  if (body.attested !== true) fail(400, 'review_attestation_required');
  const current = await repository.getReview(scope, week);
  if (current?.status === 'confirmed') {
    if (current.confirmedFromRevision === expectedRevision) return response(200, publicReview(current));
    fail(409, 'pilot_review_already_confirmed');
  }
  if (window.status !== 'closed') fail(409, 'pilot_review_week_open');
  if (!current || current.revision !== expectedRevision) fail(409, 'pilot_review_revision_conflict');
  const data = normalizeReview(Object.fromEntries(reviewFields.map((k) => [k, current[k]])), {
    complete: true,
  });
  const record = {
    ...current,
    ...data,
    status: 'confirmed',
    revision: current.revision + 1,
    updatedAt: now.toISOString(),
    confirmedAt: now.toISOString(),
    confirmedBy: identity.sub,
    confirmedFromRevision: current.revision,
    attested: true,
  };
  return response(
    200,
    publicReview(
      await repository.confirmReview({
        scope,
        enrollment,
        week,
        expectedRevision,
        record,
        summary: summarizeReview(record, enrollment.code),
      }),
    ),
  );
}

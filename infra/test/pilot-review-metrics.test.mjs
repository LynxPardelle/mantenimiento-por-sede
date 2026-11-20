import test from 'node:test';
import assert from 'node:assert/strict';
async function metrics() {
  try {
    return await import('../functions/domain/pilot-review-metrics.mjs');
  } catch {
    assert.fail('Weekly review metrics are required');
  }
}
const baseline = {
  historyLookup: { attempts: 2, successful: 1, failed: 1, medianSuccessfulSeconds: 60 },
  effortMinutes: { preparation: 10, recording: 20, assistance: 0 },
};
const record = {
  week: 1,
  period: { startDate: '2026-03-01', endDateExclusive: '2026-03-08', timeZone: 'America/New_York' },
  confirmedAt: '2026-03-08T06:00:00.000Z',
  sameProtocol: true,
  historyAttempts: [
    { success: true, seconds: 20 },
    { success: true, seconds: 40 },
    { success: false, seconds: 80 },
  ],
  effortMinutes: { preparation: 0, recording: 10, assistance: 0 },
  noteAssessment: { reviewed: 0, useful: 0 },
  summary: 'never export',
  nextAction: 'never export',
};
test('weekly aggregate and comparison preserve explicit zero, median and denominator semantics', async () => {
  const { summarizeReview, compareReview } = await metrics();
  const s = summarizeReview(record, 'pilot-' + 'a'.repeat(24));
  assert.equal(s.historyLookup.medianSuccessfulSeconds, 30);
  assert.equal(s.noteAssessment.usefulRate, null);
  assert.ok(!JSON.stringify(s).includes('never export'));
  const c = compareReview(baseline, s);
  assert.equal(c.history.deltaSeconds, -30);
  assert.equal(c.history.changePercent, -50);
  assert.equal(c.history.successRateDeltaPoints, (2 / 3 - 0.5) * 100);
  assert.equal(c.effortMinutes.total.delta, -20);
});
test('zero baselines, no successes and changed protocol never invent percentages or comparable deltas', async () => {
  const { summarizeReview, compareReview } = await metrics();
  const s = summarizeReview({ ...record, sameProtocol: false }, 'pilot-' + 'a'.repeat(24));
  let c = compareReview(baseline, s);
  assert.equal(c.reason, 'different-protocol');
  assert.equal(c.history.deltaSeconds, null);
  assert.equal(c.effortMinutes.total.delta, null);
  c = compareReview(
    { ...baseline, historyLookup: { ...baseline.historyLookup, medianSuccessfulSeconds: 0 } },
    { ...s, sameProtocol: true },
  );
  assert.equal(c.history.changePercent, null);
  c = compareReview(
    baseline,
    summarizeReview(
      { ...record, historyAttempts: [{ success: false, seconds: 0 }] },
      'pilot-' + 'a'.repeat(24),
    ),
  );
  assert.equal(c.history.reviewMedianSeconds, null);
  assert.equal(c.history.changePercent, null);
});
test('local week boundaries span daylight-saving and leap days by calendar dates', async () => {
  const { reviewPeriod } = await metrics();
  const p = reviewPeriod(
    { startDate: '2026-03-01', timeZone: 'America/New_York' },
    2,
    new Date('2026-03-15T03:59:59.999Z'),
  );
  assert.equal(p.status, 'open');
  assert.deepEqual(p.period, {
    startDate: '2026-03-08',
    endDateExclusive: '2026-03-15',
    timeZone: 'America/New_York',
  });
  assert.equal(
    reviewPeriod(
      { startDate: '2026-03-01', timeZone: 'America/New_York' },
      2,
      new Date('2026-03-15T04:00:00.000Z'),
    ).status,
    'closed',
  );
  assert.equal(
    reviewPeriod({ startDate: '2028-02-25', timeZone: 'UTC' }, 1, new Date('2028-03-03T00:00:00Z')).period
      .endDateExclusive,
    '2028-03-03',
  );
});

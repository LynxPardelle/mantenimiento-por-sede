import { testComparison, testReviewsContext, testWeeklyReview } from './pilot-reviews.fixture';
import { reviewContextResponse, weeklyReviewResponse } from './pilot-reviews.response';

describe('Frontera de respuesta de revisiones', () => {
  it('acepta el contrato actual y borradores con faltantes explícitos', () => {
    const context = testReviewsContext();
    expect(reviewContextResponse(context, 'north')).toEqual(context);
    expect(
      weeklyReviewResponse(
        {
          ...testWeeklyReview(),
          sameProtocol: null,
          historyAttempts: [],
          effortMinutes: { preparation: null, recording: null, assistance: null },
          noteAssessment: { reviewed: null, useful: null },
          summary: '',
          nextAction: '',
        },
        1,
      ).status,
    ).toBe('draft');
  });
  it('rechaza sedes, periodos y esquemas incompletos antes de renderizar', () => {
    const bad = testReviewsContext();
    bad.weeks[0].period.endDateExclusive = '2026-11-09';
    for (const value of [
      { site: {} },
      { ...testReviewsContext(), site: { ...testReviewsContext().site, id: 'other' } },
      { ...testReviewsContext(), weeks: [] },
      bad,
    ])
      expect(() => reviewContextResponse(value, 'north')).toThrow(
        'pilot_review_response_unavailable',
      );
    expect(() => weeklyReviewResponse({ ...testWeeklyReview(), effortMinutes: {} }, 1)).toThrow(
      'pilot_review_response_unavailable',
    );
    expect(() => weeklyReviewResponse(testWeeklyReview(), 2)).toThrow(
      'pilot_review_response_unavailable',
    );
  });
  it('exige que un resultado confirmado conserve su cierre y la comparación completa', () => {
    expect(() =>
      weeklyReviewResponse({ ...testWeeklyReview('confirmed'), confirmedAt: undefined }, 1),
    ).toThrow('pilot_review_response_unavailable');
    const context = testReviewsContext();
    context.weeks[0].review = testWeeklyReview('confirmed');
    expect(() => reviewContextResponse(context, 'north')).toThrow(
      'pilot_review_response_unavailable',
    );
    expect(() =>
      reviewContextResponse({ ...testReviewsContext(), checkedAt: 'invalid' }, 'north'),
    ).toThrow('pilot_review_response_unavailable');
  });
  it('acepta una comparación confirmada y rechaza diferencias sin método equivalente', () => {
    const context = testReviewsContext();
    context.weeks[0].review = testWeeklyReview('confirmed');
    context.weeks[0].comparison = testComparison();
    expect(reviewContextResponse(context, 'north').weeks[0].comparison?.history.deltaSeconds).toBe(
      -30,
    );
    context.weeks[0].comparison!.comparable = false;
    context.weeks[0].comparison!.reason = 'different-protocol';
    expect(() => reviewContextResponse(context, 'north')).toThrow(
      'pilot_review_response_unavailable',
    );
  });
});

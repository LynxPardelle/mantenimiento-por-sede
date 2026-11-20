import {
  emptyReviewModel,
  reviewPayload,
  reviewIssues,
  reviewFormModel,
} from './pilot-reviews.models';

describe('Captura semanal sin mediciones inventadas', () => {
  it('conserva los faltantes como null y distingue los ceros medidos', () => {
    const empty = reviewPayload(emptyReviewModel());
    expect(empty.sameProtocol).toBeNull();
    expect(empty.effortMinutes).toEqual({ preparation: null, recording: null, assistance: null });
    expect(empty.noteAssessment).toEqual({ reviewed: null, useful: null });
    const measured = reviewPayload({
      ...emptyReviewModel(),
      preparationMinutes: '0',
      reviewedNotes: '0',
      usefulNotes: '0',
    });
    expect(measured.effortMinutes.preparation).toBe(0);
    expect(measured.noteAssessment).toEqual({ reviewed: 0, useful: 0 });
    expect(reviewFormModel(measured).preparationMinutes).toBe('0');
  });
  it('permite confirmar una revisión cualitativa y señala mediciones incompletas', () => {
    const complete = {
      ...emptyReviewModel(),
      summary: 'Revisamos el funcionamiento de la semana.',
      nextAction: 'Repetir la búsqueda al cierre.',
    };
    expect(reviewIssues(complete, true)).toEqual([]);
    expect(
      reviewIssues({ ...complete, historyAttempts: [{ success: '', seconds: '' }] }, true).length,
    ).toBeGreaterThan(0);
    expect(reviewIssues({ ...complete, reviewedNotes: '2' }, true).length).toBeGreaterThan(0);
    expect(
      reviewIssues({ ...complete, reviewedNotes: '2', usefulNotes: '3' }, true).length,
    ).toBeGreaterThan(0);
  });
  it('rechaza números fuera del contrato incluso en un borrador y conserva valores válidos', () => {
    expect(
      reviewIssues({ ...emptyReviewModel(), preparationMinutes: '-1' }).length,
    ).toBeGreaterThan(0);
    expect(reviewIssues({ ...emptyReviewModel(), reviewedNotes: '1.5' }).length).toBeGreaterThan(0);
    const model = {
      ...emptyReviewModel(),
      sameProtocol: 'no' as const,
      historyAttempts: [{ success: 'yes' as const, seconds: '12.5' }],
    };
    expect(reviewFormModel(reviewPayload(model))).toEqual(model);
    expect(
      reviewIssues({ ...emptyReviewModel(), summary: 'a'.repeat(1001) }).length,
    ).toBeGreaterThan(0);
  });
});

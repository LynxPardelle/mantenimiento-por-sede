import { PilotEnrollment } from '../pilot/pilot.models';
import { ReviewComparison, ReviewsContext, WeeklyReview } from './pilot-reviews.models';

export const reviewSite = {
  id: 'north',
  name: 'Sede Norte',
  timeZone: 'UTC',
  role: 'coordinator' as const,
};
export const testEnrollment = (): PilotEnrollment => ({
  status: 'enrolled',
  revision: 2,
  startDate: '2026-11-01',
  code: 'pilot-example',
  classification: 'technical',
  agreedAt: '2026-10-30T12:00:00.000Z',
  scope: {
    description: 'Todos los equipos de la sede.',
    assetScope: 'all-site-assets',
    coordinators: 1,
    technicians: 2,
  },
  goals: { onTimeRateTarget: 0.85, minimumDueInspections: 10 },
  baseline: {
    weekStartDate: '2026-10-20',
    historyProtocol: 'Buscar el último resultado.',
    historyAttempts: [{ success: true, seconds: 60 }],
    effortMinutes: { preparation: 20, recording: 15, assistance: 0 },
    noteUsefulnessCriterion: 'Permite decidir la siguiente acción.',
  },
});
export const testReviewsContext = (): ReviewsContext => ({
  site: { ...reviewSite },
  enrollment: testEnrollment(),
  checkedAt: '2026-11-20T12:00:00.000Z',
  weeks: [1, 2, 3, 4].map((week) => ({
    week,
    period: {
      startDate: `2026-11-${String(1 + (week - 1) * 7).padStart(2, '0')}`,
      endDateExclusive: `2026-11-${String(1 + week * 7).padStart(2, '0')}`,
      timeZone: 'UTC',
    },
    status: week < 3 ? 'closed' : week === 3 ? 'open' : 'future',
    review: null,
    comparison: null,
  })),
});
export const testWeeklyReview = (status: 'draft' | 'confirmed' = 'draft'): WeeklyReview => ({
  week: 1,
  period: testReviewsContext().weeks[0].period,
  status,
  revision: status === 'draft' ? 1 : 2,
  createdAt: '2026-11-08T12:00:00.000Z',
  updatedAt: '2026-11-08T12:00:00.000Z',
  ...(status === 'confirmed' ? { confirmedAt: '2026-11-08T12:00:00.000Z' } : {}),
  sameProtocol: true,
  historyAttempts: [{ success: true, seconds: 30 }],
  effortMinutes: { preparation: 10, recording: 10, assistance: 0 },
  noteAssessment: { reviewed: 2, useful: 1 },
  summary: 'Fue posible consultar el historial.',
  nextAction: 'Repetir la revisión la próxima semana.',
});
export const testComparison = (): ReviewComparison => ({
  comparable: true,
  reason: 'same-protocol',
  history: {
    baselineMedianSeconds: 60,
    reviewMedianSeconds: 30,
    deltaSeconds: -30,
    changePercent: -50,
    baselineSuccessRate: 1,
    reviewSuccessRate: 1,
    successRateDeltaPoints: 0,
  },
  effortMinutes: {
    preparation: { baseline: 20, review: 10, delta: -10 },
    recording: { baseline: 15, review: 10, delta: -5 },
    assistance: { baseline: 0, review: 0, delta: 0 },
    total: { baseline: 35, review: 20, delta: -15 },
  },
  noteUsefulness: { reviewed: 2, useful: 1, rate: 0.5 },
});

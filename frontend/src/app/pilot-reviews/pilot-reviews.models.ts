import { Site } from '../maintenance/maintenance.models';
import { PilotEnrollment } from '../pilot/pilot.models';

export interface ReviewPeriod {
  startDate: string;
  endDateExclusive: string;
  timeZone: string;
}
export interface ReviewDraft {
  sameProtocol: boolean | null;
  historyAttempts: { success: boolean | null; seconds: number | null }[];
  effortMinutes: {
    preparation: number | null;
    recording: number | null;
    assistance: number | null;
  };
  noteAssessment: { reviewed: number | null; useful: number | null };
  summary: string;
  nextAction: string;
}
export interface WeeklyReview extends ReviewDraft {
  week: number;
  period: ReviewPeriod;
  status: 'draft' | 'confirmed';
  revision: number;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}
export interface ComparisonValue {
  baseline: number;
  review: number | null;
  delta: number | null;
}
export interface ReviewComparison {
  comparable: boolean;
  reason: 'same-protocol' | 'different-protocol' | 'not-attested';
  history: {
    baselineMedianSeconds: number | null;
    reviewMedianSeconds: number | null;
    deltaSeconds: number | null;
    changePercent: number | null;
    baselineSuccessRate: number;
    reviewSuccessRate: number | null;
    successRateDeltaPoints: number | null;
  };
  effortMinutes: {
    preparation: ComparisonValue;
    recording: ComparisonValue;
    assistance: ComparisonValue;
    total: ComparisonValue;
  };
  noteUsefulness: { reviewed: number | null; useful: number | null; rate: number | null };
}
export interface ReviewWeek {
  week: number;
  period: ReviewPeriod;
  status: 'future' | 'open' | 'closed';
  review: WeeklyReview | null;
  comparison: ReviewComparison | null;
}
export interface ReviewsContext {
  site: Site;
  enrollment: PilotEnrollment | null;
  checkedAt: string;
  weeks: ReviewWeek[];
}
export interface ReviewFormModel {
  sameProtocol: '' | 'yes' | 'no';
  historyAttempts: { success: '' | 'yes' | 'no'; seconds: string }[];
  preparationMinutes: string;
  recordingMinutes: string;
  assistanceMinutes: string;
  reviewedNotes: string;
  usefulNotes: string;
  summary: string;
  nextAction: string;
}
export const emptyReviewModel = (): ReviewFormModel => ({
  sameProtocol: '',
  historyAttempts: [],
  preparationMinutes: '',
  recordingMinutes: '',
  assistanceMinutes: '',
  reviewedNotes: '',
  usefulNotes: '',
  summary: '',
  nextAction: '',
});
const numeric = (value: string): number | null => (value.trim() === '' ? null : Number(value));
const input = (value: number | null): string => (value === null ? '' : String(value));
export function reviewPayload(model: ReviewFormModel): ReviewDraft {
  return {
    sameProtocol: model.sameProtocol === '' ? null : model.sameProtocol === 'yes',
    historyAttempts: model.historyAttempts.map((attempt) => ({
      success: attempt.success === '' ? null : attempt.success === 'yes',
      seconds: numeric(attempt.seconds),
    })),
    effortMinutes: {
      preparation: numeric(model.preparationMinutes),
      recording: numeric(model.recordingMinutes),
      assistance: numeric(model.assistanceMinutes),
    },
    noteAssessment: { reviewed: numeric(model.reviewedNotes), useful: numeric(model.usefulNotes) },
    summary: model.summary.trim(),
    nextAction: model.nextAction.trim(),
  };
}
export function reviewFormModel(record: ReviewDraft): ReviewFormModel {
  return {
    sameProtocol: record.sameProtocol === null ? '' : record.sameProtocol ? 'yes' : 'no',
    historyAttempts: record.historyAttempts.map((attempt) => ({
      success: attempt.success === null ? '' : attempt.success ? 'yes' : 'no',
      seconds: input(attempt.seconds),
    })),
    preparationMinutes: input(record.effortMinutes.preparation),
    recordingMinutes: input(record.effortMinutes.recording),
    assistanceMinutes: input(record.effortMinutes.assistance),
    reviewedNotes: input(record.noteAssessment.reviewed),
    usefulNotes: input(record.noteAssessment.useful),
    summary: record.summary,
    nextAction: record.nextAction,
  };
}
export function reviewIssues(model: ReviewFormModel, complete = false): string[] {
  const issues: string[] = [];
  for (const [label, value] of [
    ['el resumen de la semana', model.summary],
    ['la siguiente acción', model.nextAction],
  ]) {
    if (complete && !value.trim()) issues.push(`Completa ${label}.`);
    if (value.trim().length > 1000) issues.push(`${label}: máximo 1000 caracteres.`);
  }
  const number = (
    value: string,
    label: string,
    maximum: number,
    integer = false,
    required = false,
  ) => {
    if (value.trim() === '') {
      if (required) issues.push(`Completa ${label}.`);
      return;
    }
    const n = Number(value);
    if (
      !/^\d+(?:\.\d+)?$/.test(value.trim()) ||
      !Number.isFinite(n) ||
      n < 0 ||
      n > maximum ||
      (integer && !Number.isInteger(n))
    )
      issues.push(`${label}: usa ${integer ? 'un entero' : 'un número'} entre 0 y ${maximum}.`);
  };
  number(model.preparationMinutes, 'Minutos de preparación', 10080);
  number(model.recordingMinutes, 'Minutos de registro', 10080);
  number(model.assistanceMinutes, 'Minutos de ayuda', 10080);
  number(model.reviewedNotes, 'Notas evaluadas', 100000, true);
  number(model.usefulNotes, 'Notas útiles', 100000, true);
  if (
    model.reviewedNotes.trim() !== '' &&
    model.usefulNotes.trim() !== '' &&
    Number(model.usefulNotes) > Number(model.reviewedNotes)
  )
    issues.push('Las notas útiles no pueden superar las notas evaluadas.');
  if (complete && (model.reviewedNotes.trim() === '') !== (model.usefulNotes.trim() === ''))
    issues.push('Completa ambos conteos de notas o deja ambos sin medir.');
  if (model.historyAttempts.length > 30) issues.push('Registra como máximo 30 consultas.');
  for (const [i, attempt] of model.historyAttempts.entries()) {
    if (complete && !attempt.success) issues.push(`Indica el resultado de la consulta ${i + 1}.`);
    number(attempt.seconds, `Segundos de la consulta ${i + 1}`, 86400, false, complete);
  }
  return issues;
}

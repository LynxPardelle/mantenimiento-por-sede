import { Site } from '../maintenance/maintenance.models';

export interface PilotDraft {
  startDate: string;
  scope: {
    description: string;
    assetScope: 'all-site-assets';
    coordinators: number | null;
    technicians: number | null;
  };
  goals: { onTimeRateTarget: number | null; minimumDueInspections: number | null };
  baseline: {
    weekStartDate: string;
    historyProtocol: string;
    historyAttempts: { success: boolean | null; seconds: number | null }[];
    effortMinutes: {
      preparation: number | null;
      recording: number | null;
      assistance: number | null;
    };
    noteUsefulnessCriterion: string;
  };
}
export interface PilotEnrollment extends PilotDraft {
  status: 'draft' | 'enrolled';
  revision: number;
  code?: string;
  classification?: 'technical' | 'enrolled-real';
  agreedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface PilotContext {
  site: Site;
  earliestStartDate: string;
  latestStartDate: string;
  latestBaselineWeekStartDate: string;
  classification?: 'technical' | 'enrolled-real';
  enrollment: PilotEnrollment | null;
}
export interface PilotAgreements {
  realOperation: boolean;
  authority: boolean;
  measurement: boolean;
}
export interface PilotFormModel {
  startDate: string;
  description: string;
  coordinators: string;
  technicians: string;
  onTimePercent: string;
  minimumDueInspections: string;
  historyProtocol: string;
  baselineWeekStartDate: string;
  historyAttempts: { success: '' | 'yes' | 'no'; seconds: string }[];
  preparationMinutes: string;
  recordingMinutes: string;
  assistanceMinutes: string;
  noteUsefulnessCriterion: string;
}
export function emptyPilotModel(): PilotFormModel {
  return {
    startDate: '',
    description: '',
    coordinators: '',
    technicians: '',
    onTimePercent: '',
    minimumDueInspections: '',
    historyProtocol: '',
    baselineWeekStartDate: '',
    historyAttempts: [],
    preparationMinutes: '',
    recordingMinutes: '',
    assistanceMinutes: '',
    noteUsefulnessCriterion: '',
  };
}
const numericValue = (value: string): number | null => (value.trim() === '' ? null : Number(value));
const input = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);
export function pilotPayload(model: PilotFormModel): PilotDraft {
  const percent = numericValue(model.onTimePercent);
  return {
    startDate: model.startDate,
    scope: {
      description: model.description.trim(),
      assetScope: 'all-site-assets',
      coordinators: numericValue(model.coordinators),
      technicians: numericValue(model.technicians),
    },
    goals: {
      onTimeRateTarget: percent === null ? null : percent / 100,
      minimumDueInspections: numericValue(model.minimumDueInspections),
    },
    baseline: {
      weekStartDate: model.baselineWeekStartDate,
      historyProtocol: model.historyProtocol.trim(),
      historyAttempts: model.historyAttempts.map((attempt) => ({
        success: attempt.success === '' ? null : attempt.success === 'yes',
        seconds: numericValue(attempt.seconds),
      })),
      effortMinutes: {
        preparation: numericValue(model.preparationMinutes),
        recording: numericValue(model.recordingMinutes),
        assistance: numericValue(model.assistanceMinutes),
      },
      noteUsefulnessCriterion: model.noteUsefulnessCriterion.trim(),
    },
  };
}
export function pilotFormModel(record: PilotDraft): PilotFormModel {
  return {
    startDate: record.startDate,
    description: record.scope.description,
    coordinators: input(record.scope.coordinators),
    technicians: input(record.scope.technicians),
    onTimePercent:
      record.goals.onTimeRateTarget === null
        ? ''
        : String(Number((record.goals.onTimeRateTarget * 100).toPrecision(12))),
    minimumDueInspections: input(record.goals.minimumDueInspections),
    historyProtocol: record.baseline.historyProtocol,
    baselineWeekStartDate: record.baseline.weekStartDate,
    historyAttempts: record.baseline.historyAttempts.map((attempt) => ({
      success: attempt.success === null ? '' : attempt.success ? 'yes' : 'no',
      seconds: input(attempt.seconds),
    })),
    preparationMinutes: input(record.baseline.effortMinutes.preparation),
    recordingMinutes: input(record.baseline.effortMinutes.recording),
    assistanceMinutes: input(record.baseline.effortMinutes.assistance),
    noteUsefulnessCriterion: record.baseline.noteUsefulnessCriterion,
  };
}
export function pilotIssues(
  model: PilotFormModel,
  context: PilotContext,
  complete = false,
): string[] {
  const issues: string[] = [];
  const text = (value: string, label: string, maximum: number) => {
    if (complete && !value.trim()) issues.push(`Completa ${label}.`);
    else if (value.trim().length > maximum) issues.push(`${label}: máximo ${maximum} caracteres.`);
  };
  text(model.description, 'el alcance', 500);
  text(model.historyProtocol, 'el método de consulta', 1000);
  text(model.noteUsefulnessCriterion, 'el criterio de nota útil', 1000);
  if (complete && !model.baselineWeekStartDate)
    issues.push('Indica el inicio de la semana medida de referencia.');
  if (model.baselineWeekStartDate) {
    const date = model.baselineWeekStartDate;
    const parsed = Date.parse(date + 'T00:00:00Z');
    if (
      date < '2000-01-01' ||
      date > context.latestBaselineWeekStartDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== date
    )
      issues.push(
        'La semana medida debe tener siete días completos anteriores a hoy en la zona de la sede.',
      );
  }
  if (complete && !model.startDate) issues.push('Elige la fecha de inicio.');
  if (model.startDate) {
    const parsed = Date.parse(model.startDate + 'T00:00:00Z');
    if (
      model.startDate < context.earliestStartDate ||
      model.startDate > context.latestStartDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(model.startDate) ||
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== model.startDate
    )
      issues.push('El inicio debe estar dentro del periodo disponible de la sede.');
  }
  const numeric = (
    value: string,
    label: string,
    minimum: number,
    maximum: number,
    integer = false,
  ) => {
    if (!value.trim()) {
      if (complete) issues.push(`Registra ${label}; usa cero sólo si lo mediste.`);
      return;
    }
    const parsed = Number(value);
    if (
      !/^\d+(?:\.\d+)?$/.test(value.trim()) ||
      !Number.isFinite(parsed) ||
      parsed < minimum ||
      parsed > maximum ||
      (integer && !Number.isInteger(parsed))
    )
      issues.push(
        `${label}: usa ${integer ? 'un entero' : 'un número'} entre ${minimum} y ${maximum}.`,
      );
  };
  numeric(model.coordinators, 'personas de coordinación', 1, 1000, true);
  numeric(model.technicians, 'personas técnicas', 0, 1000, true);
  numeric(model.onTimePercent, 'el objetivo a tiempo (%)', 0, 100);
  numeric(model.minimumDueInspections, 'el mínimo de inspecciones', 1, 100000, true);
  numeric(model.preparationMinutes, 'minutos de preparación', 0, 10080);
  numeric(model.recordingMinutes, 'minutos de registro', 0, 10080);
  numeric(model.assistanceMinutes, 'minutos de ayuda', 0, 10080);
  if (complete && !model.historyAttempts.length)
    issues.push('Registra al menos una consulta de historial medida.');
  if (model.historyAttempts.length > 30) issues.push('Registra como máximo 30 consultas.');
  for (const [index, attempt] of model.historyAttempts.entries()) {
    if (complete && !attempt.success)
      issues.push(`Indica el resultado de la consulta ${index + 1}.`);
    numeric(attempt.seconds, `segundos de la consulta ${index + 1}`, 0, 86400);
  }
  return issues;
}
export function baselineSummary(model: PilotFormModel) {
  const attempts = model.historyAttempts.filter(
    (attempt) =>
      attempt.success !== '' &&
      attempt.seconds.trim() !== '' &&
      Number.isFinite(Number(attempt.seconds)),
  );
  const successful = attempts
    .filter((attempt) => attempt.success === 'yes')
    .map((attempt) => Number(attempt.seconds))
    .sort((a, b) => a - b);
  const middle = Math.floor(successful.length / 2);
  return {
    attempts: attempts.length,
    successful: successful.length,
    failed: attempts.filter((attempt) => attempt.success === 'no').length,
    medianSuccessfulSeconds: successful.length
      ? successful.length % 2
        ? successful[middle]
        : (successful[middle - 1] + successful[middle]) / 2
      : null,
  };
}

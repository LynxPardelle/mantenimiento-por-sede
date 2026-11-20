import {
  baselineSummary,
  emptyPilotModel,
  pilotFormModel,
  pilotIssues,
  pilotPayload,
} from './pilot.models';
import { PilotContext } from './pilot.models';

const context: PilotContext = {
  site: { id: 'north', name: 'Norte', role: 'coordinator', timeZone: 'America/Mexico_City' },
  earliestStartDate: '2026-11-21',
  latestStartDate: '2027-02-18',
  latestBaselineWeekStartDate: '2026-11-13',
  enrollment: null,
};

describe('Mediciones de referencia del piloto', () => {
  it('exige una semana medida explícita al confirmar y permite un borrador sin fecha', () => {
    const model = { ...emptyPilotModel(), baselineWeekStartDate: '' };
    expect(pilotIssues(model, context).some((issue) => issue.includes('semana medida'))).toBe(
      false,
    );
    expect(pilotIssues(model, context, true).some((issue) => issue.includes('semana medida'))).toBe(
      true,
    );
  });

  it('conserva el periodo medido y rechaza semanas recientes o fechas imposibles', () => {
    const datedContext = { ...context, latestBaselineWeekStartDate: '2026-11-13' };
    const model = { ...emptyPilotModel(), baselineWeekStartDate: '2026-11-10' };
    const draft = pilotPayload(model);
    expect(draft.baseline.weekStartDate).toBe('2026-11-10');
    expect(pilotFormModel(draft).baselineWeekStartDate).toBe('2026-11-10');
    for (const baselineWeekStartDate of ['2026-11-14', '2026-02-30', '1999-12-31']) {
      const candidate = { ...model, baselineWeekStartDate };
      expect(
        pilotIssues(candidate, datedContext).some((issue) => issue.includes('semana medida')),
      ).toBe(true);
    }
  });

  it('distingue los campos vacíos de un cero medido y no infiere éxito', () => {
    const model = emptyPilotModel();
    model.historyAttempts = [{ success: '', seconds: '' }];
    const draft = pilotPayload(model);
    expect(draft.scope.coordinators).toBeNull();
    expect(draft.baseline.effortMinutes).toEqual({
      preparation: null,
      recording: null,
      assistance: null,
    });
    expect(draft.baseline.historyAttempts).toEqual([{ success: null, seconds: null }]);
    model.assistanceMinutes = '0';
    model.historyAttempts = [{ success: 'no', seconds: '0' }];
    expect(pilotPayload(model).baseline.historyAttempts).toEqual([{ success: false, seconds: 0 }]);
    expect(pilotPayload(model).baseline.effortMinutes.assistance).toBe(0);
  });

  it('calcula la mediana sólo de las consultas resueltas y conserva el denominador de todas', () => {
    const model = emptyPilotModel();
    model.historyAttempts = [
      { success: 'yes', seconds: '40' },
      { success: 'no', seconds: '900' },
      { success: 'yes', seconds: '20' },
      { success: '', seconds: '' },
    ];
    expect(baselineSummary(model)).toEqual({
      attempts: 3,
      successful: 2,
      failed: 1,
      medianSuccessfulSeconds: 30,
    });
    model.historyAttempts = [{ success: 'no', seconds: '60' }];
    expect(baselineSummary(model).medianSuccessfulSeconds).toBeNull();
  });

  it('convierte el porcentaje a proporción y recupera el borrador sin rellenar faltantes', () => {
    const model = { ...emptyPilotModel(), onTimePercent: '85.5' };
    const draft = pilotPayload(model);
    expect(draft.goals.onTimeRateTarget).toBe(0.855);
    expect(pilotFormModel(draft)).toEqual(model);
  });

  it('rechaza fechas imposibles y números fuera de rango sin convertirlos en observaciones vacías', () => {
    const model = {
      ...emptyPilotModel(),
      startDate: '2026-11-99',
      coordinators: '1.2',
      technicians: '-1',
      onTimePercent: '101',
      minimumDueInspections: 'NaN',
    };
    expect(pilotIssues(model, context)).toHaveLength(5);
    expect(pilotIssues(emptyPilotModel(), context, true).length).toBeGreaterThan(5);
  });
});

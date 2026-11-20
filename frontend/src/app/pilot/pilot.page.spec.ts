import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { PilotPage } from './pilot.page';
import { PilotService } from './pilot.service';
import { PilotContext, PilotEnrollment, emptyPilotModel } from './pilot.models';

const site = {
  id: 'north',
  name: 'Sede Norte',
  timeZone: 'America/Mexico_City',
  role: 'coordinator' as const,
};
const context = (): PilotContext => ({
  site,
  earliestStartDate: '2026-11-21',
  latestStartDate: '2027-02-18',
  latestBaselineWeekStartDate: '2026-11-13',
  enrollment: null,
});
const complete = () => ({
  ...emptyPilotModel(),
  startDate: '2026-11-21',
  baselineWeekStartDate: '2026-11-10',
  description: 'Revisiones de la sede completa',
  coordinators: '1',
  technicians: '2',
  onTimePercent: '85',
  minimumDueInspections: '10',
  historyProtocol: 'Encontrar el último resultado de los mismos equipos.',
  historyAttempts: [
    { success: 'yes' as const, seconds: '90' },
    { success: 'no' as const, seconds: '180' },
  ],
  preparationMinutes: '20',
  recordingMinutes: '15',
  assistanceMinutes: '0',
  noteUsefulnessCriterion: 'Debe identificar resultado y acción necesaria.',
});

describe('Onboarding del piloto desde la operación', () => {
  async function ready(fixture: ComponentFixture<PilotPage>) {
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
    fixture.detectChanges();
  }
  function setup(existing: PilotEnrollment | null = null, technician = false) {
    let current = { ...context(), enrollment: existing };
    const service = {
      sites: vi.fn(async () => [{ ...site, role: technician ? 'technician' : 'coordinator' }]),
      context: vi.fn(async () => structuredClone(current)),
      save: vi.fn(async (_site: string, expectedRevision: number, input: object) => {
        const record = {
          ...input,
          status: 'draft',
          revision: expectedRevision + 1,
        } as PilotEnrollment;
        current = { ...current, enrollment: record };
        return structuredClone(record);
      }),
      enroll: vi.fn(async (_site: string, expectedRevision: number) => {
        const record = {
          ...current.enrollment!,
          status: 'enrolled',
          revision: expectedRevision + 1,
          code: 'pilot-example',
          classification: 'technical',
          agreedAt: '2026-11-20T02:00:00Z',
        } as PilotEnrollment;
        current = { ...current, enrollment: record };
        return structuredClone(record);
      }),
    };
    TestBed.configureTestingModule({
      imports: [PilotPage],
      providers: [
        provideRouter([]),
        { provide: PilotService, useValue: service },
        { provide: AuthService, useValue: { initialize: async () => {}, isDemo: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(PilotPage);
    return { fixture, service };
  }

  it('deja vacíos los datos no medidos y los tres acuerdos sin seleccionar', async () => {
    const { fixture } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    expect(page.model().coordinators).toBe('');
    expect(page.model().preparationMinutes).toBe('');
    expect(page.model().historyAttempts).toEqual([]);
    expect(page.model().baselineWeekStartDate).toBe('');
    expect(page.agreements()).toEqual({
      realOperation: false,
      authority: false,
      measurement: false,
    });
    expect(page.model().startDate).toBe('2026-11-21');
  });

  it('conserva el formulario al fallar el guardado y permite reintentar con la misma revisión', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.model.set(complete());
    service.save.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
    await page.saveDraft();
    expect(page.model().description).toBe(complete().description);
    expect(page.error()).toContain('intentarlo');
    await page.saveDraft();
    expect(service.save.mock.calls.map((call) => call[1])).toEqual([0, 0]);
    expect(page.context()?.enrollment?.revision).toBe(1);
    expect(page.model().baselineWeekStartDate).toBe('2026-11-10');
  });

  it('no inscribe sin acuerdos y conserva la revisión confirmada ante una respuesta perdida', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.model.set(complete());
    await page.confirm();
    expect(service.enroll).not.toHaveBeenCalled();
    page.agreements.set({ realOperation: true, authority: true, measurement: true });
    service.enroll.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await page.confirm();
    expect(page.context()?.enrollment?.revision).toBe(1);
    await page.confirm();
    expect(service.save).toHaveBeenCalledTimes(1);
    expect(service.enroll.mock.calls.map((call) => call[1])).toEqual([1, 1]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Piloto inscrito');
    expect(fixture.nativeElement.textContent).toContain('Inscripción técnica');
    expect(fixture.nativeElement.textContent).toContain('Sede Norte');
  });

  it('exige recarga explícita ante un conflicto y conserva los valores locales', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.model.set(complete());
    service.save.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    await page.saveDraft();
    expect(page.conflict()).toBe(true);
    expect(page.model().description).toBe(complete().description);
    expect(service.context).toHaveBeenCalledTimes(1);
    await page.reload();
    expect(service.context).toHaveBeenCalledTimes(2);
    expect(page.model().description).toBe('');
  });

  it('recupera el borrador persistido después de recargar la pantalla', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.model.set(complete());
    await page.saveDraft();
    page.model.update((value) => ({ ...value, description: 'Cambio sin guardar' }));
    await page.reload();
    expect(page.model().description).toBe(complete().description);
    expect(page.model().baselineWeekStartDate).toBe('2026-11-10');
    expect(page.context()?.enrollment?.revision).toBe(1);
    expect(service.context).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sessionStorage)).not.toContain(complete().description);
    expect(JSON.stringify(localStorage)).not.toContain(complete().description);
  });

  it('no consulta el piloto de una persona sin coordinación', async () => {
    const { fixture, service } = setup(null, true);
    await ready(fixture);
    expect(service.context).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('coordinación');
  });

  it('bloquea guardados y cambio de sede mientras hay una petición pendiente', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.model.set(complete());
    let release!: (value: PilotEnrollment) => void;
    service.save.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = page.saveDraft();
    await page.saveDraft();
    await page.changeSite('other');
    expect(service.save).toHaveBeenCalledTimes(1);
    expect(service.context).toHaveBeenCalledTimes(1);
    release({ ...service.save.mock.calls[0][2], revision: 1, status: 'draft' } as PilotEnrollment);
    await pending;
    expect(page.busy()).toBe(false);
  });
});

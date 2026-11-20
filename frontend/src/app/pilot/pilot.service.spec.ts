import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PilotService } from './pilot.service';
import { emptyPilotModel, pilotPayload } from './pilot.models';

const context = () => ({
  site: { id: 'north', name: 'Sede Norte', timeZone: 'America/Mexico_City', role: 'coordinator' },
  earliestStartDate: '2026-11-21',
  latestStartDate: '2027-02-18',
  latestBaselineWeekStartDate: '2026-11-13',
  classification: 'technical',
  enrollment: null,
});

const enrollment = () => ({
  status: 'enrolled',
  revision: 5,
  code: 'pilot-example',
  classification: 'technical',
  agreedAt: '2026-11-20T02:00:00.000Z',
  startDate: '2026-11-21',
  scope: {
    description: 'Revisiones preventivas de la sede',
    assetScope: 'all-site-assets',
    coordinators: 1,
    technicians: 0,
  },
  goals: { onTimeRateTarget: 0.8, minimumDueInspections: 10 },
  baseline: {
    weekStartDate: '2026-11-10',
    historyProtocol: 'Consultar el mismo historial.',
    historyAttempts: [{ success: true, seconds: 60 }],
    effortMinutes: { preparation: 10, recording: 20, assistance: 0 },
    noteUsefulnessCriterion: 'Debe identificar resultado y acción.',
  },
});

describe('Contrato HTTP de inscripción al piloto', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('consulta sólo el contexto de la sede elegida y desactiva la caché de transferencia', async () => {
    const service = TestBed.inject(PilotService);
    const request = service.context('north');
    const http = TestBed.inject(HttpTestingController).expectOne('/api/v1/sites/north/pilot');
    expect(http.request.method).toBe('GET');
    expect(http.request.transferCache).toBe(false);
    http.flush(context());
    await request;
  });

  it('rechaza una respuesta anterior sin el periodo disponible antes de exponerla a la pantalla', async () => {
    const { latestBaselineWeekStartDate: omitted, ...oldSchema } = context();
    const request = TestBed.inject(PilotService).context('north');
    const assertion = expect(request).rejects.toThrow('pilot_response_unavailable');
    TestBed.inject(HttpTestingController).expectOne('/api/v1/sites/north/pilot').flush(oldSchema);
    await assertion;
  });

  it('acepta un borrador actual con semana vacía y mediciones pendientes', async () => {
    const draft = { ...pilotPayload(emptyPilotModel()), status: 'draft', revision: 1 };
    const request = TestBed.inject(PilotService).context('north');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/sites/north/pilot')
      .flush({ ...context(), enrollment: draft });
    expect((await request).enrollment?.baseline.weekStartDate).toBe('');
  });

  it('rechaza sedes distintas, fechas imposibles, zonas y clasificaciones desconocidas', async () => {
    const invalid = [
      { ...context(), site: { ...context().site, id: 'other' } },
      { ...context(), earliestStartDate: '2026-02-30' },
      { ...context(), latestStartDate: '2026-11-01' },
      { ...context(), latestBaselineWeekStartDate: '2026-99-99' },
      { ...context(), site: { ...context().site, timeZone: 'not/a-zone' } },
      { ...context(), classification: 'paid' },
    ];
    for (const response of invalid) {
      const request = TestBed.inject(PilotService).context('north');
      const assertion = expect(request).rejects.toThrow('pilot_response_unavailable');
      TestBed.inject(HttpTestingController).expectOne('/api/v1/sites/north/pilot').flush(response);
      await assertion;
    }
  });

  it('rechaza un registro antiguo sin semana medida y un inscrito con fecha inválida', async () => {
    const old = enrollment();
    const { weekStartDate: omitted, ...baseline } = old.baseline;
    for (const record of [
      { ...old, status: 'draft', baseline },
      { ...old, baseline: { ...old.baseline, weekStartDate: '' } },
      { ...old, startDate: '2026-02-30' },
    ]) {
      const request = TestBed.inject(PilotService).context('north');
      const assertion = expect(request).rejects.toThrow('pilot_response_unavailable');
      TestBed.inject(HttpTestingController)
        .expectOne('/api/v1/sites/north/pilot')
        .flush({ ...context(), enrollment: record });
      await assertion;
    }
  });

  it('envía revisión y acuerdos sin incluir identidad, organización o clasificación', async () => {
    const request = TestBed.inject(PilotService).enroll('north', 4, {
      realOperation: true,
      authority: true,
      measurement: true,
    });
    const http = TestBed.inject(HttpTestingController).expectOne(
      '/api/v1/sites/north/pilot/enrollment',
    );
    expect(http.request.method).toBe('POST');
    expect(http.request.body).toEqual({
      expectedRevision: 4,
      agreements: { realOperation: true, authority: true, measurement: true },
    });
    http.flush(enrollment());
    await request;
  });
});

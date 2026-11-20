import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { PilotReviewsPage } from './pilot-reviews.page';
import { PilotReviewsService } from './pilot-reviews.service';
import {
  reviewSite,
  testComparison,
  testReviewsContext,
  testWeeklyReview,
} from './pilot-reviews.fixture';
import { ReviewDraft, ReviewsContext, WeeklyReview } from './pilot-reviews.models';

describe('Revisiones del piloto desde la app', () => {
  function setup(options: { context?: ReviewsContext; technician?: boolean } = {}) {
    let current = options.context || testReviewsContext();
    const service = {
      sites: vi.fn(async () => [
        { ...reviewSite, role: options.technician ? 'technician' : 'coordinator' },
      ]),
      context: vi.fn(async () => structuredClone(current)),
      save: vi.fn(
        async (_site: string, week: number, expectedRevision: number, input: ReviewDraft) => {
          const record = {
            ...input,
            week,
            period: current.weeks[week - 1].period,
            status: 'draft',
            revision: expectedRevision + 1,
            createdAt: '2026-11-08T12:00:00.000Z',
            updatedAt: '2026-11-08T12:00:00.000Z',
          } as WeeklyReview;
          current.weeks[week - 1].review = record;
          return structuredClone(record);
        },
      ),
      confirm: vi.fn(async (_site: string, week: number, revision: number) => {
        const record = {
          ...current.weeks[week - 1].review!,
          status: 'confirmed',
          revision: revision + 1,
          confirmedAt: '2026-11-08T12:00:00.000Z',
        } as WeeklyReview;
        current.weeks[week - 1].review = record;
        current.weeks[week - 1].comparison = testComparison();
        return structuredClone(record);
      }),
    };
    TestBed.configureTestingModule({
      imports: [PilotReviewsPage],
      providers: [
        provideRouter([]),
        { provide: PilotReviewsService, useValue: service },
        { provide: AuthService, useValue: { initialize: async () => {}, isDemo: () => false } },
      ],
    });
    return { fixture: TestBed.createComponent(PilotReviewsPage), service };
  }
  async function ready(fixture: ComponentFixture<PilotReviewsPage>) {
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
    await fixture.whenStable();
  }
  it('muestra las cuatro ventanas y bloquea escrituras de semanas futuras', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    expect(page.model().preparationMinutes).toBe('');
    expect(page.attestation().attested).toBe(false);
    page.changeWeek(4);
    await page.saveDraft();
    await page.confirm();
    expect(service.save).not.toHaveBeenCalled();
    expect(service.confirm).not.toHaveBeenCalled();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Esta semana todavía no comienza');
  });
  it('permite borrador en una semana abierta, conserva errores y recupera lo guardado', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.changeWeek(3);
    page.model.update((m) => ({ ...m, summary: 'Una observación sin medir todavía.' }));
    service.save.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
    await page.saveDraft();
    expect(page.model().summary).toContain('observación');
    await page.saveDraft();
    expect(service.save.mock.calls.map((c) => c[2])).toEqual([0, 0]);
    page.model.update((m) => ({ ...m, summary: 'Local sin guardar' }));
    await page.reload();
    expect(page.model().summary).toContain('observación');
    await page.confirm();
    expect(service.confirm).not.toHaveBeenCalled();
  });
  it('exige declaración y conserva la revisión al perder respuesta de confirmación', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.model.update((m) => ({
      ...m,
      summary: 'Revisamos la semana.',
      nextAction: 'Repetir el procedimiento.',
      sameProtocol: 'yes',
      historyAttempts: [{ success: 'yes', seconds: '30' }],
      preparationMinutes: '10',
      recordingMinutes: '10',
      assistanceMinutes: '0',
      reviewedNotes: '2',
      usefulNotes: '1',
    }));
    await page.confirm();
    expect(service.confirm).not.toHaveBeenCalled();
    page.attestation.set({ attested: true });
    service.confirm.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await page.confirm();
    await page.confirm();
    expect(service.save).toHaveBeenCalledTimes(1);
    expect(service.confirm.mock.calls.map((c) => c[2])).toEqual([1, 1]);
    expect(page.confirmed()).toBe(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Comparación con la línea base');
    expect(fixture.nativeElement.textContent).toContain('60');
    expect(fixture.nativeElement.textContent).toContain('30');
    expect(fixture.nativeElement.textContent).toContain('1 de 1 consultas');
  });
  it('no sobrescribe cambios al cambiar semana y recarga explícitamente ante conflictos', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.model.update((m) => ({ ...m, summary: 'Cambio local' }));
    page.changeWeek(2);
    expect(page.currentWeek()?.week).toBe(1);
    service.save.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    await page.saveDraft();
    expect(page.conflict()).toBe(true);
    expect(page.model().summary).toBe('Cambio local');
    expect(service.context).toHaveBeenCalledTimes(1);
    await page.reload();
    expect(page.model().summary).toBe('');
    expect(page.conflict()).toBe(false);
  });
  it('conserva la confirmación si falla la lectura posterior y no vuelve a escribirla', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.model.update((m) => ({ ...m, summary: 'Observación.', nextAction: 'Seguimiento.' }));
    page.attestation.set({ attested: true });
    service.context.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
    await page.confirm();
    expect(page.confirmed()).toBe(true);
    await page.confirm();
    await page.saveDraft();
    expect(service.confirm).toHaveBeenCalledTimes(1);
    expect(service.save).toHaveBeenCalledTimes(1);
    expect(page.notice()).toContain('confirmada');
    expect(page.error()).toContain('comparación');
  });
  it('evita consultas de revisión de una persona sin coordinación', async () => {
    const { fixture, service } = setup({ technician: true });
    await ready(fixture);
    expect(service.context).not.toHaveBeenCalled();
    expect(fixture.componentInstance.eligibleSites()).toEqual([]);
  });
  it('explica cómo inscribirse antes de ofrecer revisiones', async () => {
    const { fixture, service } = setup({
      context: { ...testReviewsContext(), enrollment: null, weeks: [] },
    });
    await ready(fixture);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Primero inscribe tu piloto');
    await fixture.componentInstance.saveDraft();
    expect(service.save).not.toHaveBeenCalled();
  });
  it('bloquea cambios de semana y escrituras duplicadas mientras guarda', async () => {
    const { fixture, service } = setup();
    await ready(fixture);
    const page = fixture.componentInstance;
    page.model.update((m) => ({ ...m, summary: 'Pendiente de guardar' }));
    const original = service.save.getMockImplementation()!;
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    service.save.mockImplementationOnce(async (...args) => {
      await waiting;
      return original(...args);
    });
    const first = page.saveDraft();
    page.changeWeek(2);
    await page.saveDraft();
    await page.confirm();
    expect(page.currentWeek()?.week).toBe(1);
    expect(service.save).toHaveBeenCalledTimes(1);
    expect(service.confirm).not.toHaveBeenCalled();
    finish();
    await first;
    expect(page.busy()).toBe(false);
    expect(page.currentWeek()?.review?.revision).toBe(1);
  });
  it('explica la utilidad de notas sin medir sin convertirla en conteos', async () => {
    const context = testReviewsContext();
    context.weeks[0].review = {
      ...testWeeklyReview('confirmed'),
      noteAssessment: { reviewed: null, useful: null },
    };
    context.weeks[0].comparison = {
      ...testComparison(),
      noteUsefulness: { reviewed: null, useful: null, rate: null },
    };
    const { fixture } = setup({ context });
    await ready(fixture);
    fixture.componentInstance.changeWeek(1);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'Utilidad de las notas: sin medir esta semana.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Sin medir de Sin medir');
    context.weeks[0].review!.noteAssessment = { reviewed: 0, useful: 0 };
    context.weeks[0].comparison!.noteUsefulness = { reviewed: 0, useful: 0, rate: null };
    await fixture.componentInstance.reload();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toMatch(/0 de\s*0 evaluadas.*Sin tasa/);
  });
  it('presenta el instante de captura en español y en la zona congelada de la semana', async () => {
    const context = testReviewsContext();
    for (const week of context.weeks) week.period.timeZone = 'America/Mexico_City';
    Object.assign(context.enrollment!, { timeZone: 'America/Mexico_City' });
    const capturedAt = '2026-11-09T02:30:00.000Z';
    context.weeks[0].review = {
      ...testWeeklyReview('confirmed'),
      period: context.weeks[0].period,
      confirmedAt: capturedAt,
    };
    context.weeks[0].comparison = testComparison();
    const { fixture } = setup({ context });
    await ready(fixture);
    fixture.componentInstance.changeWeek(1);
    await fixture.whenStable();
    const time = fixture.nativeElement.querySelector('time');
    expect(time).not.toBeNull();
    expect(time.getAttribute('datetime')).toBe(capturedAt);
    expect(time.textContent).toContain('20:30');
    expect(time.textContent).toContain('nov');
    expect(time.textContent).toContain('America/Mexico_City');
    expect(time.textContent).not.toContain(capturedAt);
  });
});

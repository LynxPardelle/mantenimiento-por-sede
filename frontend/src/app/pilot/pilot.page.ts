import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { applyEach, disabled, FormField, form, maxLength, required } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { displayLocalDate, Site } from '../maintenance/maintenance.models';
import {
  baselineSummary,
  emptyPilotModel,
  PilotAgreements,
  PilotContext,
  PilotEnrollment,
  pilotFormModel,
  pilotIssues,
  pilotPayload,
} from './pilot.models';
import { PilotService } from './pilot.service';

@Component({
  selector: 'app-pilot',
  imports: [RouterLink, FormField],
  templateUrl: './pilot.page.html',
  styleUrl: './pilot.page.css',
})
export class PilotPage {
  readonly auth = inject(AuthService);
  private readonly service = inject(PilotService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  readonly sites = signal<Site[]>([]);
  readonly context = signal<PilotContext | undefined>(undefined);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly conflict = signal(false);
  readonly step = signal(0);
  readonly validationIssues = signal<string[]>([]);
  readonly model = signal(emptyPilotModel());
  readonly agreements = signal<PilotAgreements>({
    realOperation: false,
    authority: false,
    measurement: false,
  });
  private readonly savedSignature = signal('');
  readonly eligibleSites = computed(() =>
    this.sites().filter((site) => site.role === 'coordinator'),
  );
  readonly enrolled = computed(() => this.context()?.enrollment?.status === 'enrolled');
  readonly dirty = computed(
    () => JSON.stringify(pilotPayload(this.model())) !== this.savedSignature(),
  );
  readonly summary = computed(() => baselineSummary(this.model()));
  readonly localDate = displayLocalDate;
  readonly lastPilotDate = computed(() => {
    const milliseconds = Date.parse(`${this.model().startDate}T00:00:00Z`);
    return Number.isFinite(milliseconds)
      ? new Date(milliseconds + 27 * 86400000).toISOString().slice(0, 10)
      : '';
  });
  readonly baselineWeekEndDate = computed(() => {
    const milliseconds = Date.parse(`${this.model().baselineWeekStartDate}T00:00:00Z`);
    return Number.isFinite(milliseconds)
      ? new Date(milliseconds + 6 * 86400000).toISOString().slice(0, 10)
      : '';
  });
  readonly steps = ['Alcance', 'Objetivos', 'Línea base', 'Confirmación'];
  readonly pilotForm = form(this.model, (path) => {
    required(path.startDate);
    required(path.description);
    maxLength(path.description, 500);
    required(path.coordinators);
    required(path.technicians);
    required(path.onTimePercent);
    required(path.minimumDueInspections);
    required(path.historyProtocol);
    required(path.baselineWeekStartDate);
    maxLength(path.historyProtocol, 1000);
    required(path.preparationMinutes);
    required(path.recordingMinutes);
    required(path.assistanceMinutes);
    required(path.noteUsefulnessCriterion);
    maxLength(path.noteUsefulnessCriterion, 1000);
    applyEach(path.historyAttempts, (attempt) => {
      required(attempt.success);
      required(attempt.seconds);
    });
    disabled(path, () => this.busy() || this.enrolled());
  });
  readonly agreementForm = form(this.agreements, (path) =>
    disabled(path, () => this.busy() || this.enrolled()),
  );
  constructor() {
    afterNextRender(() => void this.initialize());
  }
  async initialize(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.initialize();
      this.sites.set(await this.service.sites());
      const first = this.eligibleSites()[0];
      if (first) this.acceptContext(await this.service.context(first.id));
    } catch (error) {
      this.handleError(error, 'No se pudo consultar la inscripción. Vuelve a intentarlo.');
    } finally {
      this.busy.set(false);
    }
  }
  async changeSite(siteId: string): Promise<void> {
    if (
      this.busy() ||
      !this.eligibleSites().some((site) => site.id === siteId) ||
      this.context()?.site.id === siteId
    )
      return;
    if (this.dirty() && this.context()) {
      this.error.set('Guarda el borrador o recarga los datos guardados antes de cambiar de sede.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      this.acceptContext(await this.service.context(siteId));
    } catch (error) {
      this.handleError(error, 'No se pudo consultar la sede. Vuelve a intentarlo.');
    } finally {
      this.busy.set(false);
    }
  }
  async selectSite(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    await this.changeSite(select.value);
    select.value = this.context()?.site.id || '';
  }
  async reload(): Promise<void> {
    if (this.busy()) return;
    const siteId = this.context()?.site.id;
    if (!siteId) {
      await this.initialize();
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      this.acceptContext(await this.service.context(siteId));
      this.notice.set('Datos guardados recuperados.');
    } catch (error) {
      this.handleError(error, 'No se pudo recuperar el borrador. Vuelve a intentarlo.');
    } finally {
      this.busy.set(false);
    }
  }
  async saveDraft(): Promise<void> {
    const context = this.context();
    if (this.busy() || !context || this.enrolled()) return;
    const issues = pilotIssues(this.model(), context);
    if (issues.length) {
      this.showIssues(issues);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.validationIssues.set([]);
    try {
      await this.persistDraft();
      this.notice.set('Borrador guardado. Puedes retomarlo desde otro dispositivo.');
    } catch (error) {
      this.handleError(
        error,
        'No se pudo guardar el borrador. Conservamos tus datos; vuelve a intentarlo.',
      );
    } finally {
      this.busy.set(false);
    }
  }
  async confirm(): Promise<void> {
    const context = this.context();
    if (this.busy() || !context || this.enrolled()) return;
    const issues = pilotIssues(this.model(), context, true);
    if (issues.length) {
      this.showIssues(issues);
      return;
    }
    if (!Object.values(this.agreements()).every(Boolean)) {
      this.showIssues(['Confirma los tres acuerdos antes de inscribir el piloto.']);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.validationIssues.set([]);
    try {
      let draft = context.enrollment;
      if (!draft || this.dirty()) draft = await this.persistDraft();
      const enrolled = await this.service.enroll(context.site.id, draft!.revision, {
        ...this.agreements(),
      });
      this.acceptRecord(enrolled);
      this.validationIssues.set([]);
      this.focusHeading();
    } catch (error) {
      this.handleError(
        error,
        'No pudimos comprobar la confirmación. Conservamos el borrador; vuelve a intentarlo para consultar el resultado.',
      );
    } finally {
      this.busy.set(false);
    }
  }
  goToStep(step: number): void {
    if (this.busy() || step < 0 || step > 3) return;
    if (step === 3 && this.context()) {
      const issues = pilotIssues(this.model(), this.context()!, true);
      if (issues.length) {
        this.showIssues(issues);
        return;
      }
    }
    if (step < this.step())
      this.agreements.set({ realOperation: false, authority: false, measurement: false });
    this.step.set(step);
    this.error.set('');
    this.validationIssues.set([]);
    this.focusHeading();
  }
  addAttempt(): void {
    if (!this.busy() && !this.enrolled() && this.model().historyAttempts.length < 30)
      this.model.update((model) => ({
        ...model,
        historyAttempts: [...model.historyAttempts, { success: '', seconds: '' }],
      }));
  }
  removeAttempt(index: number): void {
    if (!this.busy() && !this.enrolled())
      this.model.update((model) => ({
        ...model,
        historyAttempts: model.historyAttempts.filter((_, position) => position !== index),
      }));
  }
  private acceptContext(context: PilotContext): void {
    this.context.set(context);
    this.step.set(0);
    this.conflict.set(false);
    this.validationIssues.set([]);
    this.notice.set('');
    this.agreements.set({ realOperation: false, authority: false, measurement: false });
    this.model.set(
      context.enrollment
        ? pilotFormModel(context.enrollment)
        : { ...emptyPilotModel(), startDate: context.earliestStartDate },
    );
    this.savedSignature.set(JSON.stringify(pilotPayload(this.model())));
  }
  private acceptRecord(record: PilotEnrollment): void {
    this.context.update((context) => (context ? { ...context, enrollment: record } : context));
    this.model.set(pilotFormModel(record));
    this.savedSignature.set(JSON.stringify(pilotPayload(this.model())));
    this.conflict.set(false);
  }
  private async persistDraft(): Promise<PilotEnrollment> {
    const context = this.context()!;
    const record = await this.service.save(
      context.site.id,
      context.enrollment?.revision || 0,
      pilotPayload(this.model()),
    );
    this.acceptRecord(record);
    this.validationIssues.set([]);
    return record;
  }
  private showIssues(issues: string[]): void {
    this.validationIssues.set(issues);
    this.error.set('Revisa los datos indicados para continuar.');
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[role="alert"]')?.focus(),
      { injector: this.injector },
    );
  }
  private handleError(error: unknown, fallback: string): void {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    this.conflict.set(status === 409);
    this.error.set(
      status === 409
        ? 'La inscripción cambió en otra sesión o ya fue confirmada. Conservamos tus cambios. Recarga los datos guardados para revisar la versión actual.'
        : status === 403 || status === 404
          ? 'Esta sede requiere acceso de coordinación. Vuelve a tu operación para revisar el acceso.'
          : fallback,
    );
  }
  private focusHeading(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[data-step-heading]')?.focus(),
      { injector: this.injector },
    );
  }
}

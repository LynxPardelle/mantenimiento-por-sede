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
import { disabled, FormField, form, maxLength } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { displayLocalDate, Site } from '../maintenance/maintenance.models';
import {
  emptyReviewModel,
  reviewFormModel,
  reviewIssues,
  reviewPayload,
  ReviewsContext,
  WeeklyReview,
} from './pilot-reviews.models';
import { PilotReviewsService } from './pilot-reviews.service';

@Component({
  selector: 'app-pilot-reviews',
  imports: [RouterLink, FormField],
  templateUrl: './pilot-reviews.page.html',
  styleUrl: './pilot-reviews.page.css',
})
export class PilotReviewsPage {
  readonly auth = inject(AuthService);
  private readonly service = inject(PilotReviewsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  readonly sites = signal<Site[]>([]);
  readonly eligibleSites = computed(() =>
    this.sites().filter((site) => site.role === 'coordinator'),
  );
  readonly context = signal<ReviewsContext | undefined>(undefined);
  readonly selectedWeek = signal(1);
  readonly currentWeek = computed(() =>
    this.context()?.weeks.find((week) => week.week === this.selectedWeek()),
  );
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly conflict = signal(false);
  readonly issues = signal<string[]>([]);
  readonly model = signal(emptyReviewModel());
  readonly attestation = signal({ attested: false });
  private readonly savedSignature = signal(JSON.stringify(reviewPayload(emptyReviewModel())));
  readonly dirty = computed(
    () => JSON.stringify(reviewPayload(this.model())) !== this.savedSignature(),
  );
  readonly confirmed = computed(() => this.currentWeek()?.review?.status === 'confirmed');
  readonly baselineAttempts = computed(() => {
    const attempts = this.context()?.enrollment?.baseline.historyAttempts || [];
    return {
      successful: attempts.filter((attempt) => attempt.success === true).length,
      total: attempts.length,
    };
  });
  readonly reviewedAttempts = computed(() => {
    const attempts = this.currentWeek()?.review?.historyAttempts || [];
    return {
      successful: attempts.filter((attempt) => attempt.success === true).length,
      total: attempts.length,
    };
  });
  readonly canEdit = computed(
    () =>
      !!this.currentWeek() &&
      this.currentWeek()!.status !== 'future' &&
      !this.confirmed() &&
      !this.busy(),
  );
  readonly reviewForm = form(this.model, (path) => {
    maxLength(path.summary, 1000);
    maxLength(path.nextAction, 1000);
    disabled(path, () => !this.canEdit());
  });
  readonly attestationForm = form(this.attestation, (path) =>
    disabled(path, () => !this.canEdit() || this.currentWeek()?.status !== 'closed'),
  );
  readonly localDate = displayLocalDate;
  readonly effortRows = [
    { key: 'preparation', label: 'Preparación' },
    { key: 'recording', label: 'Registro' },
    { key: 'assistance', label: 'Ayuda' },
    { key: 'total', label: 'Total' },
  ] as const;
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
      this.handleError(error, 'No se pudieron consultar las revisiones. Vuelve a intentarlo.');
    } finally {
      this.busy.set(false);
    }
  }
  async selectSite(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    await this.changeSite(select.value);
    select.value = this.context()?.site.id || '';
  }
  async changeSite(site: string): Promise<void> {
    if (
      this.busy() ||
      this.context()?.site.id === site ||
      !this.eligibleSites().some((item) => item.id === site)
    )
      return;
    if (!this.canLeave()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.acceptContext(await this.service.context(site));
    } catch (error) {
      this.handleError(error, 'No se pudo consultar la sede. Conservamos la revisión actual.');
    } finally {
      this.busy.set(false);
    }
  }
  changeWeek(week: number): void {
    if (
      this.busy() ||
      week === this.selectedWeek() ||
      !this.context()?.weeks.some((item) => item.week === week) ||
      !this.canLeave()
    )
      return;
    this.selectedWeek.set(week);
    this.acceptSelection();
    this.error.set('');
    this.notice.set('');
    this.conflict.set(false);
    this.issues.set([]);
  }
  async reload(): Promise<void> {
    if (this.busy()) return;
    const site = this.context()?.site.id;
    if (!site) return this.initialize();
    this.busy.set(true);
    this.error.set('');
    try {
      this.acceptContext(await this.service.context(site), this.selectedWeek());
      this.notice.set('Revisión guardada recuperada.');
    } catch (error) {
      this.handleError(error, 'No se pudo recuperar la revisión. Conservamos tus valores.');
    } finally {
      this.busy.set(false);
    }
  }
  async saveDraft(): Promise<void> {
    if (!this.canEdit()) return;
    const issues = reviewIssues(this.model());
    if (issues.length) return this.showIssues(issues);
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.issues.set([]);
    try {
      await this.persistDraft();
      this.notice.set('Borrador semanal guardado. Puedes retomarlo desde otro dispositivo.');
    } catch (error) {
      this.handleError(error, 'No se pudo guardar. Conservamos tus valores; vuelve a intentarlo.');
    } finally {
      this.busy.set(false);
    }
  }
  async confirm(): Promise<void> {
    const week = this.currentWeek();
    const context = this.context();
    if (!this.canEdit() || !week || !context || week.status !== 'closed') return;
    const issues = reviewIssues(this.model(), true);
    if (!this.attestation().attested)
      issues.push(
        'Confirma que la revisión corresponde a esta semana y que los datos son los observados.',
      );
    if (issues.length) return this.showIssues(issues);
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.issues.set([]);
    try {
      let draft = week.review;
      if (!draft || this.dirty()) draft = await this.persistDraft();
      this.acceptRecord(await this.service.confirm(context.site.id, week.week, draft!.revision));
      this.notice.set('Revisión semanal confirmada. Su contenido queda conservado.');
      try {
        this.acceptContext(await this.service.context(context.site.id), week.week);
        this.notice.set('Revisión semanal confirmada. Su contenido queda conservado.');
      } catch {
        this.error.set(
          'La revisión quedó confirmada. Recarga para consultar su comparación con la línea base.',
        );
      }
    } catch (error) {
      this.handleError(
        error,
        'No pudimos comprobar la confirmación. Conservamos tu revisión; vuelve a intentarlo para consultar el resultado.',
      );
    } finally {
      this.busy.set(false);
    }
  }
  addAttempt(): void {
    if (this.canEdit() && this.model().historyAttempts.length < 30)
      this.model.update((model) => ({
        ...model,
        historyAttempts: [...model.historyAttempts, { success: '', seconds: '' }],
      }));
  }
  removeAttempt(index: number): void {
    if (this.canEdit())
      this.model.update((model) => ({
        ...model,
        historyAttempts: model.historyAttempts.filter((_, i) => i !== index),
      }));
  }
  statusLabel(status: string): string {
    return status === 'closed' ? 'Terminada' : status === 'open' ? 'En curso' : 'Próxima';
  }
  periodLastDay(end: string): string {
    return new Date(Date.parse(end + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  }
  value(value: number | null, suffix = ''): string {
    return value === null
      ? 'Sin medir'
      : `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(value)}${suffix}`;
  }
  rate(value: number | null): string {
    return this.value(value === null ? null : value * 100, ' %');
  }
  capturedTime(value: string, timeZone: string): string {
    return `${new Intl.DateTimeFormat('es-MX', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value))} (${timeZone})`;
  }
  private canLeave(): boolean {
    if (this.dirty()) {
      this.error.set(
        'Guarda el borrador o recarga los datos guardados antes de cambiar de semana o sede.',
      );
      return false;
    }
    return true;
  }
  private acceptContext(context: ReviewsContext, preferred?: number): void {
    this.context.set(context);
    this.selectedWeek.set(
      preferred && context.weeks.some((week) => week.week === preferred)
        ? preferred
        : (
            context.weeks.find(
              (week) => week.status === 'closed' && week.review?.status !== 'confirmed',
            ) ||
            context.weeks.find((week) => week.status === 'open') ||
            context.weeks[0]
          )?.week || 1,
    );
    this.acceptSelection();
    this.conflict.set(false);
    this.issues.set([]);
    this.notice.set('');
  }
  private acceptSelection(): void {
    const review = this.currentWeek()?.review;
    this.model.set(review ? reviewFormModel(review) : emptyReviewModel());
    this.savedSignature.set(JSON.stringify(reviewPayload(this.model())));
    this.attestation.set({ attested: false });
  }
  private acceptRecord(record: WeeklyReview): void {
    const current = this.currentWeek();
    if (
      !current ||
      record.week !== current.week ||
      record.period.startDate !== current.period.startDate ||
      record.period.endDateExclusive !== current.period.endDateExclusive ||
      record.period.timeZone !== current.period.timeZone
    )
      throw new Error('pilot_review_response_unavailable');
    this.context.update((context) =>
      context
        ? {
            ...context,
            weeks: context.weeks.map((week) =>
              week.week === record.week ? { ...week, review: record, comparison: null } : week,
            ),
          }
        : context,
    );
    this.model.set(reviewFormModel(record));
    this.savedSignature.set(JSON.stringify(reviewPayload(this.model())));
    this.conflict.set(false);
  }
  private async persistDraft(): Promise<WeeklyReview> {
    const week = this.currentWeek()!;
    const record = await this.service.save(
      this.context()!.site.id,
      week.week,
      week.review?.revision || 0,
      reviewPayload(this.model()),
    );
    this.acceptRecord(record);
    return record;
  }
  private showIssues(issues: string[]): void {
    this.issues.set(issues);
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
        ? 'La revisión cambió en otra sesión, la semana cambió de estado o ya fue confirmada. Conservamos tus valores. Recarga la versión guardada para revisarla.'
        : status === 403 || status === 404
          ? 'Esta sede requiere acceso de coordinación. Revisa tu acceso desde la operación.'
          : fallback,
    );
  }
}

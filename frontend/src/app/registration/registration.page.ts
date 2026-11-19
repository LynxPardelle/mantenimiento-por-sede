import { afterNextRender, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import {
  disabled,
  email,
  FormField,
  form,
  maxLength,
  minLength,
  pattern,
  required,
} from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { RegistrationError, RegistrationInput, RegistrationService } from './registration.service';

@Component({
  selector: 'app-registration',
  imports: [RouterLink, FormField],
  templateUrl: './registration.page.html',
  styleUrl: './registration.page.css',
})
export class RegistrationPage {
  readonly auth = inject(AuthService);
  private readonly registration = inject(RegistrationService);
  readonly stage = signal<'register' | 'confirm' | 'complete'>('register');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly destination = signal('');
  private readonly currentTime = signal(Date.now());
  private readonly resendAt = signal(0);
  readonly cooldown = computed(() =>
    Math.max(0, Math.ceil((this.resendAt() - this.currentTime()) / 1000)),
  );
  readonly available = computed(
    () => this.auth.config()?.authMode === 'cognito' && this.auth.config()?.signupEnabled === true,
  );
  readonly registrationModel = signal<RegistrationInput>({
    organizationName: '',
    siteName: '',
    email: '',
    password: '',
    timeZone: 'America/Mexico_City',
  });
  readonly registrationForm = form(this.registrationModel, (path) => {
    required(path.organizationName);
    maxLength(path.organizationName, 120);
    required(path.siteName);
    maxLength(path.siteName, 120);
    required(path.email);
    email(path.email);
    maxLength(path.email, 254);
    required(path.password);
    minLength(path.password, 14);
    maxLength(path.password, 256);
    pattern(path.password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).+$/);
    required(path.timeZone);
    disabled(path, () => this.busy());
  });
  readonly confirmationModel = signal({ email: '', code: '' });
  readonly confirmationForm = form(this.confirmationModel, (path) => {
    required(path.email);
    email(path.email);
    maxLength(path.email, 254);
    required(path.code);
    pattern(path.code, /^\d{6}$/);
    disabled(path, () => this.busy());
  });
  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      void this.prepare();
      const timer = setInterval(() => this.currentTime.set(Date.now()), 1000);
      destroy.onDestroy(() => clearInterval(timer));
    });
    destroy.onDestroy(() => this.registrationModel.update((value) => ({ ...value, password: '' })));
  }
  async prepare(): Promise<void> {
    try {
      await this.auth.initialize();
    } catch {
      /* auth exposes a retryable error */
    }
  }
  async register(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.available() || this.busy() || this.registrationForm().invalid()) return;
    const input = this.registrationModel();
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const result = await this.registration.signUp(input);
      this.registrationModel.update((value) => ({ ...value, password: '' }));
      this.confirmationModel.set({ email: input.email.trim().toLowerCase(), code: '' });
      this.destination.set(result.destination);
      this.stage.set(result.confirmed ? 'complete' : 'confirm');
      if (!result.confirmed) {
        this.notice.set('Revisa tu correo para encontrar el código de verificación.');
        this.startCooldown();
      }
    } catch (error) {
      this.error.set(message(error));
      if (error instanceof RegistrationError && error.accountMayExist) {
        this.registrationModel.update((value) => ({ ...value, password: '' }));
        this.confirmationModel.set({ email: input.email.trim().toLowerCase(), code: '' });
        this.stage.set('confirm');
        if (error.code !== 'UsernameExistsException') this.startCooldown();
      }
    } finally {
      this.busy.set(false);
    }
  }
  useExistingCode(): void {
    this.confirmationModel.set({
      email: this.registrationModel().email.trim().toLowerCase(),
      code: '',
    });
    this.registrationModel.update((value) => ({ ...value, password: '' }));
    this.stage.set('confirm');
    this.error.set('');
    this.notice.set('');
  }
  async confirm(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.available() || this.busy() || this.confirmationForm().invalid()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const input = this.confirmationModel();
      await this.registration.confirm(input.email, input.code);
      this.confirmationModel.update((value) => ({ ...value, code: '' }));
      this.stage.set('complete');
    } catch (error) {
      this.error.set(message(error));
    } finally {
      this.busy.set(false);
    }
  }
  async resend(): Promise<void> {
    const input = this.confirmationModel();
    if (
      !this.available() ||
      this.busy() ||
      this.cooldown() > 0 ||
      this.confirmationForm.email().invalid()
    )
      return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      this.destination.set(await this.registration.resend(input.email));
      this.confirmationModel.update((value) => ({ ...value, code: '' }));
      this.notice.set(
        'Solicitamos un nuevo código. Revisa tu correo y la carpeta de correo no deseado.',
      );
      this.startCooldown();
    } catch (error) {
      this.error.set(message(error));
      if (
        error instanceof RegistrationError &&
        ['LimitExceededException', 'TooManyRequestsException'].includes(error.code)
      )
        this.startCooldown();
    } finally {
      this.busy.set(false);
    }
  }
  async login(): Promise<void> {
    this.error.set('');
    try {
      await this.auth.login();
    } catch {
      this.error.set('No pudimos abrir el acceso. Inténtalo de nuevo.');
    }
  }
  private startCooldown(): void {
    this.currentTime.set(Date.now());
    this.resendAt.set(Date.now() + 60000);
  }
}
function message(error: unknown): string {
  return error instanceof RegistrationError
    ? error.message
    : 'No pudimos completar la solicitud. Inténtalo de nuevo en unos minutos.';
}

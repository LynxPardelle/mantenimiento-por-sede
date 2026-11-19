import { afterNextRender, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-callback',
  imports: [RouterLink],
  template: `<main class="access-page">
    <a class="brand" routerLink="/">SedePulso.</a>
    <h1>Preparando tu acceso</h1>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <a class="button primary" routerLink="/">Volver al inicio</a>
    } @else {
      <p role="status">Estamos comprobando la sesión de esta pestaña.</p>
    }
  </main>`,
})
export class CallbackPage {
  readonly error = signal('');
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  constructor() {
    afterNextRender(() => {
      void this.complete();
    });
  }
  async complete(): Promise<void> {
    const search = location.search;
    // Retirar el código de la barra antes de solicitudes o navegación posteriores.
    history.replaceState(history.state, '', '/auth/callback');
    try {
      await this.auth.completeLogin(search);
      await this.router.navigateByUrl('/app', { replaceUrl: true });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo completar el acceso.');
    }
  }
}

import { Component, afterNextRender, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
})
export class HomePage {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly error = signal('');
  constructor() {
    afterNextRender(() => {
      void this.prepare();
    });
  }
  async prepare(): Promise<void> {
    try {
      await this.auth.initialize();
    } catch {
      /* auth expone el error */
    }
  }
  async login(): Promise<void> {
    this.error.set('');
    try {
      await this.auth.login();
    } catch {
      this.error.set('No pudimos iniciar el acceso. Vuelve a intentarlo.');
    }
  }
  async demo(): Promise<void> {
    this.auth.enterDemo();
    await this.router.navigateByUrl('/app');
  }
}

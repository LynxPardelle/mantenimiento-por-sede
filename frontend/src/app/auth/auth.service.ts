import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface RuntimeConfig {
  authMode: 'demo' | 'cognito';
  region?: string;
  userPoolId?: string;
  clientId?: string;
  authDomain?: string;
  redirectUri?: string;
  logoutUri?: string;
  signupEnabled?: boolean;
}
interface Session {
  accessToken: string;
  expiresAt: number;
}
interface LoginTransaction {
  state: string;
  verifier: string;
  createdAt: number;
  redirectUri: string;
}
const sessionKey = 'sedepulso.session';
const demoKey = 'sedepulso.demo';
const transactionKey = 'sedepulso.login';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly config = signal<RuntimeConfig | undefined>(undefined);
  readonly error = signal('');
  readonly loading = signal(false);
  private readonly session = signal<Session | undefined>(undefined);
  private readonly demo = signal(false);
  private initialization?: Promise<void>;
  readonly isDemo = computed(() => this.config()?.authMode === 'demo' && this.demo());
  readonly authenticated = computed(() => this.isDemo() || !!this.session());

  initialize(): Promise<void> {
    if (!this.browser) return Promise.resolve();
    if (this.initialization) return this.initialization;
    this.initialization = this.loadConfig().catch((error: unknown) => {
      this.initialization = undefined;
      this.error.set('No se pudo preparar el acceso. Vuelve a intentarlo.');
      throw error;
    });
    return this.initialization;
  }

  private async loadConfig(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const config = await firstValueFrom(
        this.http.get<RuntimeConfig>('/api/config', { timeout: 10000, transferCache: false }),
      );
      if (config.authMode !== 'demo' && config.authMode !== 'cognito')
        throw new Error('Configuración de acceso inválida');
      this.config.set(config);
      this.demo.set(config.authMode === 'demo' && sessionStorage.getItem(demoKey) === 'true');
      if (config.authMode !== 'demo') sessionStorage.removeItem(demoKey);
      const raw = sessionStorage.getItem(sessionKey);
      if (raw && config.authMode === 'cognito') {
        try {
          const restored = JSON.parse(raw) as Session;
          if (
            restored.expiresAt > Date.now() &&
            this.validAccessToken(restored.accessToken, config.clientId)
          )
            this.session.set(restored);
          else sessionStorage.removeItem(sessionKey);
        } catch {
          sessionStorage.removeItem(sessionKey);
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  enterDemo(): void {
    if (!this.browser || this.config()?.authMode !== 'demo')
      throw new Error('La demostración sólo está disponible en el entorno local.');
    sessionStorage.setItem(demoKey, 'true');
    this.demo.set(true);
  }

  token(): string {
    const current = this.session();
    if (!current || current.expiresAt <= Date.now()) {
      if (current) this.clearSession();
      return '';
    }
    return current.accessToken;
  }

  async login(): Promise<void> {
    await this.initialize();
    const config = this.config();
    if (!this.browser || config?.authMode !== 'cognito' || !config.clientId) return;
    const redirectUri = config.redirectUri || `${location.origin}/auth/callback`;
    if (
      new URL(redirectUri).origin !== location.origin ||
      new URL(redirectUri).pathname !== '/auth/callback'
    )
      throw new Error('El destino del acceso no corresponde a esta aplicación.');
    const verifier = randomUrlValue(64);
    const state = randomUrlValue(32);
    const challenge = base64Url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
    );
    const transaction: LoginTransaction = { state, verifier, createdAt: Date.now(), redirectUri };
    sessionStorage.setItem(transactionKey, JSON.stringify(transaction));
    const authorize = new URL('/oauth2/authorize', this.authOrigin(config));
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    location.assign(authorize.href);
  }

  async completeLogin(search: string): Promise<void> {
    if (!this.browser) return;
    const params = new URLSearchParams(search);
    const raw = sessionStorage.getItem(transactionKey);
    sessionStorage.removeItem(transactionKey);
    let transaction: LoginTransaction | undefined;
    try {
      transaction = raw ? (JSON.parse(raw) as LoginTransaction) : undefined;
    } catch {
      /* rejected below */
    }
    if (
      !transaction ||
      transaction.state !== params.get('state') ||
      !params.get('code') ||
      params.has('error') ||
      Date.now() - transaction.createdAt > 600000 ||
      transaction.createdAt > Date.now()
    ) {
      throw new Error(
        'La solicitud de acceso venció o no corresponde a esta pestaña. Inicia sesión de nuevo.',
      );
    }
    await this.initialize();
    const config = this.config();
    if (config?.authMode !== 'cognito' || !config.clientId)
      throw new Error('El acceso no está configurado.');
    const expectedRedirect = config.redirectUri || `${location.origin}/auth/callback`;
    if (
      transaction.redirectUri !== expectedRedirect ||
      new URL(expectedRedirect).origin !== location.origin
    )
      throw new Error('El destino del acceso cambió. Inicia sesión de nuevo.');
    const response = await firstValueFrom(
      this.http.post<{ access_token: string; expires_in: number }>(
        `${this.authOrigin(config)}/oauth2/token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          code: params.get('code')!,
          redirect_uri: transaction.redirectUri,
          code_verifier: transaction.verifier,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
          transferCache: false,
        },
      ),
    );
    if (!this.validAccessToken(response.access_token, config.clientId))
      throw new Error('La respuesta de acceso no es válida.');
    const claims = accessClaims(response.access_token);
    const expiresAt = Math.min(
      Number(claims['exp']) * 1000,
      Date.now() + Number(response.expires_in) * 1000,
    );
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new Error('La sesión ya venció. Inicia sesión de nuevo.');
    const session = { accessToken: response.access_token, expiresAt };
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    this.session.set(session);
  }

  logout(): void {
    this.clearSession();
    if (!this.browser) return;
    sessionStorage.removeItem(transactionKey);
    const config = this.config();
    if (config?.authMode === 'cognito' && config.clientId) {
      const logoutUri = config.logoutUri || `${location.origin}/`;
      if (new URL(logoutUri).origin !== location.origin) {
        location.assign('/');
        return;
      }
      const url = new URL('/logout', this.authOrigin(config));
      url.search = new URLSearchParams({
        client_id: config.clientId,
        logout_uri: logoutUri,
      }).toString();
      location.assign(url.href);
    } else location.assign('/');
  }

  clearSession(): void {
    this.session.set(undefined);
    this.demo.set(false);
    if (this.browser) {
      sessionStorage.removeItem(sessionKey);
      sessionStorage.removeItem(demoKey);
    }
  }

  private authOrigin(config: RuntimeConfig): string {
    if (!config.authDomain) throw new Error('Falta el dominio de acceso.');
    const domain = new URL(
      config.authDomain.includes('://') ? config.authDomain : `https://${config.authDomain}`,
    );
    if (domain.protocol !== 'https:' || domain.username || domain.password)
      throw new Error('El dominio de acceso debe usar HTTPS.');
    return domain.origin;
  }
  private validAccessToken(token: string, clientId?: string): boolean {
    try {
      const claims = accessClaims(token);
      // La API verifica firma y emisor. El cliente sólo comprueba tipo, cliente y vencimiento.
      return (
        claims['token_use'] === 'access' &&
        claims['client_id'] === clientId &&
        Number(claims['exp']) * 1000 > Date.now()
      );
    } catch {
      return false;
    }
  }
}

function accessClaims(token: string): Record<string, unknown> {
  const encoded = token.split('.')[1];
  if (!encoded) throw new Error('Token inválido');
  return JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
}
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
function randomUrlValue(size: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const token = request.url.startsWith('/api/v1/') ? auth.token() : '';
  return next(
    token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request,
  );
};

export const sessionGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.browser) return true;
  try {
    await auth.initialize();
  } catch {
    return router.parseUrl('/');
  }
  return auth.isDemo() || !!auth.token() ? true : router.parseUrl('/?session=required');
};

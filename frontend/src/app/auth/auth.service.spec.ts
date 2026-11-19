import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService, authInterceptor } from './auth.service';
import { HttpClient } from '@angular/common/http';

describe('Sesión de SedePulso', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    sessionStorage.clear();
  });

  it('no activa una sesión demo hasta una acción explícita', async () => {
    const auth = TestBed.inject(AuthService);
    const initialized = auth.initialize();
    TestBed.inject(HttpTestingController).expectOne('/api/config').flush({ authMode: 'demo' });
    await initialized;
    expect(auth.authenticated()).toBe(false);
    auth.enterDemo();
    expect(auth.authenticated()).toBe(true);
    expect(auth.isDemo()).toBe(true);
  });

  it('ignora el marcador demo cuando el servidor exige Cognito', async () => {
    sessionStorage.setItem('sedepulso.demo', 'true');
    const auth = TestBed.inject(AuthService);
    const initialized = auth.initialize();
    TestBed.inject(HttpTestingController).expectOne('/api/config').flush({
      authMode: 'cognito',
      clientId: 'client',
      authDomain: 'https://login.example.com',
      redirectUri: 'http://localhost:4200/auth/callback',
    });
    await initialized;
    expect(auth.authenticated()).toBe(false);
    expect(auth.isDemo()).toBe(false);
  });

  it('rechaza un callback que no corresponde con la transacción PKCE', async () => {
    const auth = TestBed.inject(AuthService);
    await expect(auth.completeLogin('?code=abc&state=incorrect')).rejects.toThrow();
    TestBed.inject(HttpTestingController).expectNone((request) =>
      request.url.includes('/oauth2/token'),
    );
  });

  it('no adjunta autorización a destinos fuera de la API de dominio', () => {
    const http = TestBed.inject(HttpClient);
    http.get('https://external.example/api/v1/sites').subscribe();
    const request = TestBed.inject(HttpTestingController).expectOne(
      'https://external.example/api/v1/sites',
    );
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('envía el access_token únicamente a rutas de dominio y elimina la sesión al vencer', async () => {
    const currentTime = Date.now();
    const accessToken = `header.${btoa(JSON.stringify({ token_use: 'access', client_id: 'client', exp: Math.floor(currentTime / 1000) + 60 }))}.signature`;
    sessionStorage.setItem(
      'sedepulso.session',
      JSON.stringify({ accessToken, expiresAt: currentTime + 2000 }),
    );
    const auth = TestBed.inject(AuthService);
    const initialized = auth.initialize();
    const controller = TestBed.inject(HttpTestingController);
    controller
      .expectOne('/api/config')
      .flush({ authMode: 'cognito', clientId: 'client', authDomain: 'login.example.com' });
    await initialized;
    const http = TestBed.inject(HttpClient);
    http.get('/api/v1/sites').subscribe();
    const ownApi = controller.expectOne('/api/v1/sites');
    expect(ownApi.request.headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
    ownApi.flush({ items: [] });
    http.get('https://external.example/api/v1/sites').subscribe();
    const external = controller.expectOne('https://external.example/api/v1/sites');
    expect(external.request.headers.has('Authorization')).toBe(false);
    external.flush({});
    const clock = vi.spyOn(Date, 'now').mockReturnValue(currentTime + 3000);
    try {
      expect(auth.token()).toBe('');
      expect(auth.authenticated()).toBe(false);
      expect(sessionStorage.getItem('sedepulso.session')).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it('canjea el código con el verificador PKCE de esta pestaña y guarda sólo el access_token', async () => {
    const origin = location.origin;
    sessionStorage.setItem(
      'sedepulso.login',
      JSON.stringify({
        state: 'state',
        verifier: 'verifier',
        createdAt: Date.now(),
        redirectUri: `${origin}/auth/callback`,
      }),
    );
    const auth = TestBed.inject(AuthService);
    const controller = TestBed.inject(HttpTestingController);
    const login = auth.completeLogin('?code=authorization-code&state=state');
    controller.expectOne('/api/config').flush({
      authMode: 'cognito',
      clientId: 'client',
      authDomain: 'login.example.com',
      redirectUri: `${origin}/auth/callback`,
    });
    await auth.initialize();
    const tokenRequest = controller.expectOne('https://login.example.com/oauth2/token');
    expect(new URLSearchParams(tokenRequest.request.body).get('code_verifier')).toBe('verifier');
    const accessToken = `header.${btoa(JSON.stringify({ token_use: 'access', client_id: 'client', exp: Math.floor(Date.now() / 1000) + 600 }))}.signature`;
    tokenRequest.flush({
      access_token: accessToken,
      expires_in: 600,
      id_token: 'not-used',
      refresh_token: 'not-stored',
    });
    await login;
    expect(auth.token()).toBe(accessToken);
    expect(sessionStorage.getItem('sedepulso.session')).not.toContain('not-used');
    expect(sessionStorage.getItem('sedepulso.session')).not.toContain('not-stored');
    expect(sessionStorage.getItem('sedepulso.login')).toBeNull();
  });
});

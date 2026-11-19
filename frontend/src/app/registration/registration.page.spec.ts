import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { RegistrationPage } from './registration.page';

const endpoint = 'https://cognito-idp.us-east-1.amazonaws.com/';
const input = {
  organizationName: 'Mi operación',
  siteName: 'Sede Central',
  email: 'persona@example.com',
  password: 'UnaClave123!Segura',
  timeZone: 'America/Mexico_City',
};

describe('Pantalla de registro de SedePulso', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [RegistrationPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  async function page(mode: 'cognito' | 'demo' = 'cognito') {
    const fixture = TestBed.createComponent(RegistrationPage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/config')
      .flush({ authMode: mode, signupEnabled: true, clientId: 'client', region: 'us-east-1' });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('lleva del alta al código y a la activación sin conservar la contraseña', async () => {
    const fixture = await page();
    const component = fixture.componentInstance;
    component.registrationModel.set(input);
    const signup = component.register(new Event('submit'));
    await Promise.resolve();
    TestBed.inject(HttpTestingController)
      .expectOne(endpoint)
      .flush({ UserConfirmed: false, CodeDeliveryDetails: { Destination: 'p***@e***' } });
    await signup;
    fixture.detectChanges();
    expect(component.registrationModel().password).toBe('');
    expect(fixture.nativeElement.textContent).toContain('Confirma tu correo');
    expect(fixture.nativeElement.querySelector('input[type=password]')).toBeNull();
    component.confirmationModel.set({ email: input.email, code: '123456' });
    const confirm = component.confirm(new Event('submit'));
    await Promise.resolve();
    TestBed.inject(HttpTestingController).expectOne(endpoint).flush({});
    await confirm;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tu cuenta está lista');
    expect(fixture.nativeElement.querySelector('button').textContent).toContain('Entrar');
    expect(JSON.stringify(sessionStorage)).not.toContain(input.password);
    expect(JSON.stringify(localStorage)).not.toContain(input.password);
  });

  it('no afirma envío cuando Cognito alcanza el límite y conserva una ruta de confirmación', async () => {
    const fixture = await page();
    const component = fixture.componentInstance;
    component.registrationModel.set(input);
    const signup = component.register(new Event('submit'));
    await Promise.resolve();
    TestBed.inject(HttpTestingController)
      .expectOne(endpoint)
      .flush({ __type: 'LimitExceededException' }, { status: 400, statusText: 'Bad Request' });
    await signup;
    fixture.detectChanges();
    expect(component.stage()).toBe('confirm');
    expect(component.registrationModel().password).toBe('');
    expect(fixture.nativeElement.textContent).toContain('no pudo enviar');
    expect(component.notice()).not.toContain('enviamos');
  });

  it('limita el reenvío en pantalla y no abre registro real en la demostración', async () => {
    const fixture = await page();
    const component = fixture.componentInstance;
    component.useExistingCode();
    component.confirmationModel.set({ email: input.email, code: '123456' });
    const resend = component.resend();
    await Promise.resolve();
    TestBed.inject(HttpTestingController)
      .expectOne(endpoint)
      .flush({ CodeDeliveryDetails: { Destination: 'p***@e***' } });
    await resend;
    expect(component.cooldown()).toBeGreaterThan(0);
    expect(component.confirmationModel().code).toBe('');
    await component.resend();
    TestBed.inject(HttpTestingController).expectNone(endpoint);
    fixture.destroy();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RegistrationPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const demo = await page('demo');
    expect(demo.nativeElement.textContent).toContain('demostración local');
    expect(demo.nativeElement.querySelector('input[type=password]')).toBeNull();
    expect(TestBed.inject(AuthService).config()?.authMode).toBe('demo');
  });
});

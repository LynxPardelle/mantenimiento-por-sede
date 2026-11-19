import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { RegistrationService } from './registration.service';

const endpoint = 'https://cognito-idp.us-east-1.amazonaws.com/';
const input = {
  organizationName: '  Operación Norte  ',
  siteName: '  Sede Central ',
  email: 'persona@example.com',
  password: 'UnaClave123!Segura',
  timeZone: 'America/Mexico_City',
};

describe('Registro de SedePulso', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  async function configure(mode: 'cognito' | 'demo' = 'cognito') {
    const initialized = TestBed.inject(AuthService).initialize();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/config')
      .flush({ authMode: mode, signupEnabled: true, clientId: 'client', region: 'us-east-1' });
    await initialized;
    return TestBed.inject(RegistrationService);
  }

  it('envía sólo los atributos de registro y no persiste la contraseña', async () => {
    const service = await configure();
    const result = service.signUp(input);
    await Promise.resolve();
    const request = TestBed.inject(HttpTestingController).expectOne(endpoint);
    expect(request.request.headers.get('X-Amz-Target')).toBe(
      'AWSCognitoIdentityProviderService.SignUp',
    );
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.body).toEqual({
      ClientId: 'client',
      Username: input.email,
      Password: input.password,
      UserAttributes: [
        { Name: 'email', Value: input.email },
        { Name: 'custom:organizationName', Value: 'Operación Norte' },
        { Name: 'custom:siteName', Value: 'Sede Central' },
        { Name: 'custom:timeZone', Value: 'America/Mexico_City' },
      ],
    });
    request.flush({ UserConfirmed: false, CodeDeliveryDetails: { Destination: 'p***@e***' } });
    await expect(result).resolves.toEqual({ confirmed: false, destination: 'p***@e***' });
    expect(JSON.stringify(sessionStorage)).not.toContain(input.password);
    expect(JSON.stringify(localStorage)).not.toContain(input.password);
  });

  it('confirma mediante código sin volver a enviar contraseña ni elevar privilegios', async () => {
    const service = await configure();
    const result = service.confirm(input.email, '123456');
    await Promise.resolve();
    const request = TestBed.inject(HttpTestingController).expectOne(endpoint);
    expect(request.request.headers.get('X-Amz-Target')).toBe(
      'AWSCognitoIdentityProviderService.ConfirmSignUp',
    );
    expect(request.request.body).toEqual({
      ClientId: 'client',
      Username: input.email,
      ConfirmationCode: '123456',
    });
    request.flush({});
    await expect(result).resolves.toBeUndefined();
  });

  it('distingue el límite de entrega que puede dejar una cuenta creada', async () => {
    const service = await configure();
    const result = service.signUp(input);
    const rejected = expect(result).rejects.toMatchObject({
      code: 'LimitExceededException',
      accountMayExist: true,
    });
    await Promise.resolve();
    TestBed.inject(HttpTestingController)
      .expectOne(endpoint)
      .flush({ __type: 'LimitExceededException' }, { status: 400, statusText: 'Bad Request' });
    await rejected;
  });

  it('rechaza registro en demo antes de contactar Cognito', async () => {
    const service = await configure('demo');
    await expect(service.signUp(input)).rejects.toMatchObject({ code: 'RegistrationUnavailable' });
    TestBed.inject(HttpTestingController).expectNone(endpoint);
  });

  it('rechaza nombres o zona horaria inválidos sin enviar atributos a Cognito', async () => {
    const service = await configure();
    for (const changes of [
      { siteName: '   ' },
      { organizationName: 'x'.repeat(121) },
      { timeZone: 'Mars/Base' },
    ]) {
      await expect(service.signUp({ ...input, ...changes })).rejects.toMatchObject({
        code: 'InvalidInput',
      });
    }
    TestBed.inject(HttpTestingController).expectNone(endpoint);
  });

  it('permite reenviar un código y traduce código incorrecto sin exponer detalles internos', async () => {
    const service = await configure();
    const resend = service.resend(input.email);
    await Promise.resolve();
    const request = TestBed.inject(HttpTestingController).expectOne(endpoint);
    expect(request.request.headers.get('X-Amz-Target')).toBe(
      'AWSCognitoIdentityProviderService.ResendConfirmationCode',
    );
    request.flush({ CodeDeliveryDetails: { Destination: 'p***@e***' } });
    await expect(resend).resolves.toEqual('p***@e***');
    const confirmation = service.confirm(input.email, '999999');
    const rejected = expect(confirmation).rejects.toMatchObject({
      code: 'CodeMismatchException',
      message: expect.stringContaining('código'),
    });
    await Promise.resolve();
    TestBed.inject(HttpTestingController)
      .expectOne(endpoint)
      .flush(
        { __type: 'namespace#CodeMismatchException', message: 'Internal diagnostic value' },
        { status: 400, statusText: 'Bad Request' },
      );
    await rejected;
  });
});

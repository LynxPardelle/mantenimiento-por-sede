import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export interface RegistrationInput {
  organizationName: string;
  siteName: string;
  email: string;
  password: string;
  timeZone: string;
}
export class RegistrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly accountMayExist = false,
  ) {
    super(message);
  }
}
interface Delivery {
  CodeDeliveryDetails?: { Destination?: string };
}

@Injectable({ providedIn: 'root' })
export class RegistrationService {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  async signUp(input: RegistrationInput): Promise<{ confirmed: boolean; destination: string }> {
    const organizationName = name(input.organizationName);
    const siteName = name(input.siteName);
    try {
      new Intl.DateTimeFormat('es-MX', { timeZone: input.timeZone });
    } catch {
      throw new RegistrationError(
        'InvalidInput',
        'Selecciona una zona horaria válida para la sede.',
      );
    }
    const response = await this.call<Delivery & { UserConfirmed?: boolean }>('SignUp', {
      Username: email(input.email),
      Password: input.password,
      UserAttributes: [
        { Name: 'email', Value: email(input.email) },
        { Name: 'custom:organizationName', Value: organizationName },
        { Name: 'custom:siteName', Value: siteName },
        { Name: 'custom:timeZone', Value: input.timeZone },
      ],
    });
    return {
      confirmed: response.UserConfirmed === true,
      destination: response.CodeDeliveryDetails?.Destination || '',
    };
  }

  async confirm(username: string, code: string): Promise<void> {
    if (!/^\d{6}$/.test(code.trim()))
      throw new RegistrationError(
        'InvalidInput',
        'Introduce el código de seis dígitos de tu correo.',
      );
    await this.call('ConfirmSignUp', { Username: email(username), ConfirmationCode: code.trim() });
  }

  async resend(username: string): Promise<string> {
    const response = await this.call<Delivery>('ResendConfirmationCode', {
      Username: email(username),
    });
    return response.CodeDeliveryDetails?.Destination || '';
  }

  private async call<T>(operation: string, payload: object): Promise<T> {
    await this.auth.initialize();
    const config = this.auth.config();
    if (
      !this.auth.browser ||
      config?.authMode !== 'cognito' ||
      config.signupEnabled !== true ||
      !config.clientId ||
      !config.region ||
      !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(config.region)
    ) {
      throw new RegistrationError(
        'RegistrationUnavailable',
        'El registro de cuentas no está disponible en este entorno.',
      );
    }
    try {
      return await firstValueFrom(
        this.http.post<T>(
          `https://cognito-idp.${config.region}.amazonaws.com/`,
          { ClientId: config.clientId, ...payload },
          {
            headers: {
              'Content-Type': 'application/x-amz-json-1.1',
              'X-Amz-Target': `AWSCognitoIdentityProviderService.${operation}`,
            },
            timeout: 15000,
            transferCache: false,
          },
        ),
      );
    } catch (error) {
      throw registrationError(error);
    }
  }
}

function name(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized))
    throw new RegistrationError(
      'InvalidInput',
      'Escribe un nombre de organización y sede de hasta 120 caracteres.',
    );
  return normalized;
}
function email(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new RegistrationError('InvalidInput', 'Revisa el correo electrónico.');
  return normalized;
}
function registrationError(error: unknown): RegistrationError {
  if (!(error instanceof HttpErrorResponse))
    return new RegistrationError(
      'ConnectionError',
      'No pudimos completar la solicitud. Revisa tu conexión e inténtalo de nuevo.',
    );
  const code =
    typeof error.error?.__type === 'string'
      ? error.error.__type.split('#').at(-1)
      : 'ConnectionError';
  const messages: Record<string, string> = {
    UsernameExistsException:
      'Ese correo ya tiene una cuenta. Si está pendiente, confirma con tu código; si ya la activaste, inicia sesión.',
    LimitExceededException:
      'Tu cuenta puede estar creada, pero el servicio no pudo enviar el código. Espera unos minutos y solicita uno nuevo.',
    TooManyRequestsException:
      'Se hicieron demasiados intentos. Espera unos minutos antes de volver a intentar.',
    CodeMismatchException: 'El código no coincide. Revisa los seis dígitos e inténtalo de nuevo.',
    ExpiredCodeException: 'El código venció. Solicita uno nuevo para confirmar tu correo.',
    InvalidPasswordException:
      'La contraseña debe tener al menos 14 caracteres, mayúscula, minúscula, número y símbolo.',
    InvalidParameterException:
      'Revisa los datos. Si ya confirmaste tu correo, puedes iniciar sesión.',
    CodeDeliveryFailureException:
      'No se pudo enviar el código. Revisa el correo y vuelve a solicitarlo más tarde.',
    UserLambdaValidationException:
      'No se pudo preparar tu espacio con esos datos. Revisa el nombre de organización, sede y zona horaria.',
    UnexpectedLambdaException:
      'No se pudo terminar la activación. Si ya confirmaste tu correo, intenta iniciar sesión de nuevo.',
    InvalidLambdaResponseException:
      'No se pudo terminar la activación. Inténtalo de nuevo en unos minutos.',
    NotAuthorizedException:
      'No se pudo completar la confirmación. Si ya activaste tu cuenta, inicia sesión.',
    UserNotFoundException:
      'No se pudo completar la solicitud con ese correo. Revisa los datos o vuelve a crear tu cuenta.',
  };
  return new RegistrationError(
    code || 'ConnectionError',
    messages[code || ''] ||
      'No pudimos completar la solicitud. Revisa tu conexión e inténtalo de nuevo.',
    ['UsernameExistsException', 'LimitExceededException', 'CodeDeliveryFailureException'].includes(
      code || '',
    ),
  );
}

import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const signupAttributes = new Set(['custom:organizationName', 'custom:siteName', 'custom:timeZone']);
const reject = (reason) => { throw new Error(`signup_${reason}`); };

function cognitoEvent(event) {
  if (!event || typeof event !== 'object' || event.requestContext || event.rawPath || event.version !== '1' || typeof event.userPoolId !== 'string' || !event.userPoolId) reject('event');
}

function label(value, name, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !value.trim() || /[\u0000-\u001F\u007F]/.test(value)) reject(`invalid_${name}`);
  return value.trim();
}

export function signupProfile(attributes) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) reject('attributes');
  if (Object.keys(attributes).some((key) => key.startsWith('custom:') && !signupAttributes.has(key))) reject('privileged_attribute');
  if (typeof attributes.email !== 'string' || attributes.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attributes.email)) reject('invalid_email');
  const organizationName = label(attributes['custom:organizationName'], 'organization_name', 120);
  const siteName = label(attributes['custom:siteName'], 'site_name', 120);
  const requestedZone = label(attributes['custom:timeZone'], 'time_zone', 100);
  if (!/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(requestedZone)) reject('invalid_time_zone');
  let timeZone;
  try { timeZone = new Intl.DateTimeFormat('es-MX', { timeZone: requestedZone }).resolvedOptions().timeZone; }
  catch { reject('invalid_time_zone'); }
  return { organizationName, siteName, timeZone };
}

export function workspaceIdentifiers(subject) {
  if (typeof subject !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(subject)) reject('subject');
  const id = (kind) => createHash('sha256').update(`sedepulso:${kind}:v1:${subject}`).digest('hex').slice(0, 32);
  return { orgId: `org_${id('organization')}`, siteId: `site_${id('site')}` };
}

export function createPreSignUpHandler() {
  return async (event) => {
    cognitoEvent(event);
    // IAM administrators retain the existing disposable-account and invitation workflows.
    if (event.triggerSource === 'PreSignUp_AdminCreateUser') return event;
    if (event.triggerSource !== 'PreSignUp_SignUp') reject('source');
    signupProfile(event.request?.userAttributes);
    // Email possession must be confirmed by Cognito; client metadata cannot bypass it.
    event.response = { ...event.response, autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false };
    return event;
  };
}

export function createPostConfirmationHandler({ repository, now = () => new Date() }) {
  return async (event) => {
    cognitoEvent(event);
    // ConfirmForgotPassword is also a post-confirmation source, but is not tenant creation.
    if (event.triggerSource === 'PostConfirmation_ConfirmForgotPassword') return event;
    if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') reject('source');
    const attributes = event.request?.userAttributes;
    if (attributes?.email_verified !== 'true') reject('email_unverified');
    const identifiers = workspaceIdentifiers(attributes.sub);
    const profile = signupProfile(attributes);
    const createdAt = now().toISOString();
    const workspace = {
      membership: {
        pk: `USER#${attributes.sub}`, sk: 'MEMBERSHIP', orgId: identifiers.orgId,
        sites: [{ id: identifiers.siteId, name: profile.siteName, timeZone: profile.timeZone, role: 'coordinator' }],
        createdAt, onboardingVersion: 1,
      },
      organization: {
        pk: `ORG#${identifiers.orgId}`, sk: 'META', id: identifiers.orgId,
        name: profile.organizationName, ownerSub: attributes.sub, initialSiteId: identifiers.siteId,
        plan: 'pilot', status: 'active', signupSource: 'cognito', createdAt,
      },
    };
    try {
      // An existing administrative membership is authoritative, including a technician role.
      if (await repository.getMembership(attributes.sub)) return event;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await repository.createWorkspace(workspace);
          return event;
        } catch (error) {
          if (error.name !== 'TransactionCanceledException') throw error;
          const reasons = error.CancellationReasons ?? [];
          if (reasons.some(({ Code }) => Code && !['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(Code))) throw error;
          if (await repository.getMembership(attributes.sub)) return event;
          if (attempt === 4) throw error;
          // Cognito invokes synchronous triggers with a five-second limit. Keep retries short.
          await delay(20 * 2 ** attempt + Math.floor(Math.random() * 20));
        }
      }
    } catch {
      // Never log the event, account attributes, or database error payload.
      reject('workspace_pending');
    }
  };
}

const validateSignup = createPreSignUpHandler();
export const preSignUp = (event) => validateSignup(event);

let production;
export async function postConfirmation(event) {
  cognitoEvent(event);
  if (event.triggerSource === 'PostConfirmation_ConfirmForgotPassword') return event;
  production ??= import('./dynamodb.mjs').then(({ createOnboardingRepository }) => createPostConfirmationHandler({ repository: createOnboardingRepository() }));
  return (await production)(event);
}

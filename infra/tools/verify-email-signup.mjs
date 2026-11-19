import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aws, stackOutputs } from './aws.mjs';
import { workspaceIdentifiers } from '../functions/onboarding/index.mjs';

const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const environment = option('--environment');
const email = option('--email');
if (!['development', 'testing', 'production'].includes(environment) || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usa --environment development|testing|production --email <buzón autorizado>.');
const region = 'us-east-1';
const platform = stackOutputs(`sedepulso-${environment}-platform`);
const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;
const nonce = randomUUID();
const organizationName = `Prueba de registro ${nonce}`;
const startedAt = Date.now();
const password = `Sp1!${randomBytes(24).toString('base64url')}`;
let subject;
let ownsAccount = false;
let confirmed = false;
const report = { product: 'SedePulso', environment, startedAt: new Date(startedAt).toISOString(), emailDeliveryTested: false, confirmationTested: false, cleanupCompleted: false };

async function cognito(action, body) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  if (!response.ok) throw new Error(`Cognito ${action}: ${String(value.__type || 'error').split('#').at(-1)}`);
  return value;
}
function findAccount() {
  try { return aws(['cognito-idp', 'admin-get-user', '--region', region, '--user-pool-id', platform.UserPoolId, '--username', email]); }
  catch (error) { if (error.message.includes('UserNotFoundException')) return undefined; throw error; }
}
function waitForCode() {
  console.log('Código enviado al buzón autorizado. Esperando código por stdin (sin mostrarlo ni guardarlo)...');
  return new Promise((resolve, reject) => {
    let value = '';
    const raw = process.stdin.isTTY;
    if (raw) process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    const finish = (error) => {
      clearTimeout(timer); process.stdin.off('data', receive);
      if (raw) process.stdin.setRawMode(false);
      process.stdin.pause();
      if (error) reject(error); else resolve(value);
    };
    const receive = (data) => {
      if (data.includes('\u0003')) return finish(new Error('Prueba interrumpida.'));
      for (const character of data) {
        if (/[0-9]/.test(character) && value.length < 8) value += character;
        else if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character === '\n' || character === '\r') {
          if (/^\d{6,8}$/.test(value)) return finish();
          value = ''; console.log('Introduce únicamente el código numérico y pulsa Enter.');
        }
      }
    };
    const timer = setTimeout(() => finish(new Error('La prueba venció esperando confirmación.')), 10 * 60 * 1000);
    process.stdin.on('data', receive);
  });
}
async function waitForUiConfirmation() {
  console.log('Código enviado. Confirma el correo desde /registro; esperando activación sin exponer contraseña.');
  for (let attempt = 0; attempt < 150; attempt++) {
    const account = findAccount();
    if (account?.UserStatus === 'CONFIRMED') return;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  throw new Error('La prueba venció esperando confirmación en la aplicación.');
}

try {
  if (findAccount()) throw new Error('Ya existe una cuenta con ese correo en este ambiente; se conservó sin modificar.');
  const result = await cognito('SignUp', { ClientId: platform.ClientId, Username: email, Password: password, UserAttributes: [{ Name: 'email', Value: email }, { Name: 'custom:organizationName', Value: organizationName }, { Name: 'custom:siteName', Value: 'Sede de prueba de registro' }, { Name: 'custom:timeZone', Value: 'America/Mexico_City' }] });
  subject = result.UserSub; ownsAccount = true;
  assert.equal(result.UserConfirmed, false);
  assert.equal(result.CodeDeliveryDetails?.DeliveryMedium, 'EMAIL');
  if (args.includes('--via-ui')) {
    await waitForUiConfirmation();
    report.confirmationMode = 'application-ui';
  } else {
    const code = await waitForCode();
    await cognito('ConfirmSignUp', { ClientId: platform.ClientId, Username: email, ConfirmationCode: code });
    report.confirmationMode = 'api';
  }
  confirmed = true;
  report.emailDeliveryTested = true; report.confirmationTested = true;
  const auth = aws(['cognito-idp', 'admin-initiate-auth', '--region', region, '--user-pool-id', platform.UserPoolId, '--client-id', platform.ClientId, '--auth-flow', 'ADMIN_USER_PASSWORD_AUTH', '--auth-parameters', JSON.stringify({ USERNAME: email, PASSWORD: password })]);
  const response = await fetch(platform.ApiUrl + '/api/v1/sites', { headers: { authorization: `Bearer ${auth.AuthenticationResult.AccessToken}` }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const sites = await response.json();
  assert.equal(sites.items.length, 1); assert.equal(sites.items[0].role, 'coordinator');
  assert.equal(sites.items[0].name, 'Sede de prueba de registro');
  const identifiers = workspaceIdentifiers(subject);
  assert.equal(sites.items[0].id, identifiers.siteId);
  report.initialSiteCreated = true; report.verifiedAt = new Date().toISOString();
  console.log('Correo confirmado y sede creada automáticamente por el trigger de Cognito.');
} finally {
  const account = findAccount();
  if (account) {
    const attributes = Object.fromEntries(account.UserAttributes.map(({ Name, Value }) => [Name, Value]));
    // Also identify a user created by a SignUp that returned LimitExceeded after persistence.
    const matchesRun = attributes['custom:organizationName'] === organizationName && Date.parse(account.UserCreateDate) >= startedAt - 1000;
    if (matchesRun && (!subject || attributes.sub === subject)) { subject = attributes.sub; ownsAccount = true; }
    else if (ownsAccount) throw new Error('La identidad cambió durante la prueba; se conserva para revisión.');
  }
  if (ownsAccount && subject) {
    const identifiers = workspaceIdentifiers(subject);
    for (const key of [{ pk: { S: `USER#${subject}` }, sk: { S: 'MEMBERSHIP' } }, { pk: { S: `ORG#${identifiers.orgId}` }, sk: { S: 'META' } }]) {
      aws(['dynamodb', 'delete-item', '--region', region, '--table-name', platform.AccessTableName, '--key', JSON.stringify(key)]);
    }
    aws(['cognito-idp', 'admin-delete-user', '--region', region, '--user-pool-id', platform.UserPoolId, '--username', email]);
    report.cleanupCompleted = true;
  }
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', '.artifacts');
  await mkdir(out, { recursive: true });
  await writeFile(join(out, `email-signup-${environment}.json`), JSON.stringify(report, null, 2) + '\n');
  if (confirmed && !report.cleanupCompleted) throw new Error('La cuenta de prueba no se limpió correctamente.');
}
console.log(JSON.stringify(report, null, 2));

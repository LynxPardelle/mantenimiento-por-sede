import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { aws, stackOutputs } from './aws.mjs';
import { signupProfile, workspaceIdentifiers } from '../functions/onboarding/index.mjs';

const args = process.argv.slice(2);
const option = (key) => {
  const index = args.indexOf(key);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
};
const environment = option('--environment');
const repair = args.includes('--repair');
const repairUsername = option('--username');
if (!['development', 'testing', 'production'].includes(environment) || (repair && !repairUsername)) throw new Error('Usa --environment development|testing|production [--repair --username <usuario-Cognito>].');
const region = 'us-east-1';
const platform = stackOutputs(`sedepulso-${environment}-platform`, region);
if (!platform.PostConfirmationFunctionName) throw new Error('La plataforma aún no publica PostConfirmationFunctionName.');
const lambda = new LambdaClient({ region });
const cliRegion = ['--region', region];
const attributesOf = (user) => Object.fromEntries((user.UserAttributes || user.Attributes || []).map(({ Name, Value }) => [Name, Value]));
const membershipKey = (subject) => ({ pk: { S: `USER#${subject}` }, sk: { S: 'MEMBERSHIP' } });
const organizationKey = (id) => ({ pk: { S: `ORG#${id}` }, sk: { S: 'META' } });
const read = (key) => aws(['dynamodb', 'get-item', ...cliRegion, '--table-name', platform.AccessTableName, '--key', JSON.stringify(key), '--consistent-read']).Item;

async function provision(user) {
  if (!user.Enabled || user.UserStatus !== 'CONFIRMED') throw new Error('signup_account_not_confirmed');
  const attributes = attributesOf(user);
  if (attributes.email_verified !== 'true') throw new Error('signup_email_unverified');
  signupProfile(attributes);
  workspaceIdentifiers(attributes.sub);
  const event = {
    version: '1', region, userPoolId: platform.UserPoolId, userName: user.Username,
    callerContext: { awsSdkVersion: 'aws-sdk-js-3', clientId: platform.ClientId },
    triggerSource: 'PostConfirmation_ConfirmSignUp', request: { userAttributes: attributes }, response: {},
  };
  const result = await lambda.send(new InvokeCommand({ FunctionName: platform.PostConfirmationFunctionName, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(event)) }));
  if (result.FunctionError || result.StatusCode !== 200) throw new Error('signup_trigger_failed');
  const membership = read(membershipKey(attributes.sub));
  if (!membership?.orgId?.S || !membership.sites?.L?.length) throw new Error('signup_membership_missing');
  return membership;
}

const getUser = (username) => aws(['cognito-idp', 'admin-get-user', ...cliRegion, '--user-pool-id', platform.UserPoolId, '--username', username]);

if (repair) {
  const user = getUser(repairUsername);
  const previous = read(membershipKey(attributesOf(user).sub));
  const membership = await provision(user);
  if (previous) assert.deepEqual(membership, previous);
  console.log(JSON.stringify({ environment, repaired: !previous, existingMembershipPreserved: !!previous, assignedSites: membership.sites.L.length }));
} else {
  const suffix = randomUUID();
  const username = `smoke-signup-${suffix}@example.invalid`;
  const checks = [];
  let created = false;
  let subject;
  let identifiers;
  try {
    // Administrative test account, with delivery suppressed. This does not test email delivery.
    const attributes = [
      { Name: 'email', Value: username }, { Name: 'email_verified', Value: 'true' },
      { Name: 'custom:organizationName', Value: `Prueba de registro ${suffix.slice(0, 8)}` },
      { Name: 'custom:siteName', Value: 'Sede de prueba de registro' },
      { Name: 'custom:timeZone', Value: 'America/Mexico_City' },
    ];
    const createdUser = aws(['cognito-idp', 'admin-create-user', ...cliRegion, '--user-pool-id', platform.UserPoolId, '--username', username, '--message-action', 'SUPPRESS', '--user-attributes', JSON.stringify(attributes)]);
    created = true;
    subject = attributesOf(createdUser.User).sub;
    identifiers = workspaceIdentifiers(subject);
    const password = `Sp1!${randomBytes(24).toString('base64url')}`;
    aws(['cognito-idp', 'admin-set-user-password', ...cliRegion, '--user-pool-id', platform.UserPoolId, '--username', username, '--password', password, '--permanent']);
    const user = getUser(username);
    assert.equal(read(membershipKey(subject)), undefined);
    const membership = await provision(user);
    assert.equal(membership.orgId.S, identifiers.orgId);
    assert.equal(membership.sites.L[0].M.id.S, identifiers.siteId);
    assert.equal(membership.sites.L[0].M.role.S, 'coordinator');
    checks.push('confirmación provisiona organización y sede propias');
    const organization = read(organizationKey(identifiers.orgId));
    assert.equal(organization.ownerSub.S, subject);
    assert.equal(organization.plan.S, 'pilot');
    assert.equal(organization.status.S, 'active');
    checks.push('plan piloto y rol definidos por el servidor');
    assert.deepEqual(await provision(user), membership);
    checks.push('repetición preserva la membresía original');
    const authentication = aws(['cognito-idp', 'admin-initiate-auth', ...cliRegion, '--user-pool-id', platform.UserPoolId, '--client-id', platform.ClientId, '--auth-flow', 'ADMIN_USER_PASSWORD_AUTH', '--auth-parameters', JSON.stringify({ USERNAME: username, PASSWORD: password })]);
    const token = authentication.AuthenticationResult?.AccessToken;
    if (!token) throw new Error('signup_smoke_auth_failed');
    const host = `https://sedepulso${environment === 'production' ? '' : '-' + environment}.lynxpardelle.com`;
    const response = await fetch(`${host}/api/v1/sites`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    const sites = await response.json();
    assert.deepEqual(sites.items, [{ id: identifiers.siteId, name: 'Sede de prueba de registro', timeZone: 'America/Mexico_City', role: 'coordinator' }]);
    checks.push('identidad real consulta su sede mediante JWT y CloudFront');
  } finally {
    const cleanupErrors = [];
    const cleanup = (operation) => { try { operation(); } catch (error) { cleanupErrors.push(error.message); } };
    if (subject && identifiers) {
      cleanup(() => aws(['dynamodb', 'delete-item', ...cliRegion, '--table-name', platform.AccessTableName, '--key', JSON.stringify(membershipKey(subject)), '--condition-expression', 'attribute_not_exists(pk) OR orgId = :org', '--expression-attribute-values', JSON.stringify({ ':org': { S: identifiers.orgId } })]));
      cleanup(() => aws(['dynamodb', 'delete-item', ...cliRegion, '--table-name', platform.AccessTableName, '--key', JSON.stringify(organizationKey(identifiers.orgId)), '--condition-expression', 'attribute_not_exists(pk) OR ownerSub = :sub', '--expression-attribute-values', JSON.stringify({ ':sub': { S: subject } })]));
    }
    if (created) cleanup(() => aws(['cognito-idp', 'admin-delete-user', ...cliRegion, '--user-pool-id', platform.UserPoolId, '--username', username]));
    if (cleanupErrors.length) throw new Error(`signup_smoke_cleanup_failed: ${cleanupErrors.join('; ')}`);
  }
  if (created && subject && identifiers) {
    assert.equal(read(membershipKey(subject)), undefined);
    assert.equal(read(organizationKey(identifiers.orgId)), undefined);
    checks.push('membresía y organización temporales eliminadas');
  }
  const report = { product: 'SedePulso', environment, checkedAt: new Date().toISOString(), checks, ephemeralAccountDeleted: created, emailDeliveryTested: false };
  const artifacts = join(dirname(fileURLToPath(import.meta.url)), '..', '.artifacts');
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, `signup-${environment}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

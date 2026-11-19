import assert from 'node:assert/strict';
import test from 'node:test';

async function implementation() {
  try { return await import('../functions/onboarding/index.mjs'); }
  catch { assert.fail('The self-service onboarding handlers must be implemented.'); }
}
const attributes = {
  sub: '4db6ce1e-5154-4872-8f04-001122334455', email: 'owner@example.invalid', email_verified: 'true',
  'custom:organizationName': 'Operación de prueba', 'custom:siteName': 'Sede Norte', 'custom:timeZone': 'America/Mexico_City',
};
const event = (triggerSource, overrides = {}) => ({
  version: '1', region: 'us-east-1', userPoolId: 'us-east-1_test', userName: 'subject',
  callerContext: { clientId: 'public-client' }, triggerSource,
  request: { userAttributes: { ...attributes } }, response: {}, ...overrides,
});
const condition = () => Object.assign(new Error('concurrent transaction'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
function repository() {
  const rows = new Map();
  const creations = [];
  return {
    rows, creations,
    getMembership: async (sub) => rows.get(`USER#${sub}`),
    createWorkspace: async (workspace) => {
      const key = workspace.membership.pk;
      if (rows.has(key)) throw condition();
      creations.push(workspace);
      rows.set(key, structuredClone(workspace.membership));
    },
  };
}

test('self-service signup validates persisted attributes and keeps email confirmation enabled', async () => {
  const { createPreSignUpHandler } = await implementation();
  const preSignUp = createPreSignUpHandler();
  const input = event('PreSignUp_SignUp', { response: { autoConfirmUser: true, autoVerifyEmail: true, autoVerifyPhone: true } });
  delete input.request.userAttributes.sub;
  delete input.request.userAttributes.email_verified;
  const result = await preSignUp(input);
  assert.equal(result, input);
  assert.deepEqual(result.response, { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false });
});

test('self-service signup rejects missing, oversized, invalid or privileged attributes', async () => {
  const { createPreSignUpHandler } = await implementation();
  const handler = createPreSignUpHandler();
  for (const change of [
    { 'custom:organizationName': '' }, { 'custom:organizationName': ' '.repeat(3) },
    { 'custom:siteName': 'x'.repeat(121) }, { 'custom:siteName': 'Sede\nOtra' },
    { 'custom:timeZone': 'Mars/Olympus' }, { 'custom:timeZone': '' },
    { email: 'not-an-email' }, { 'custom:orgId': 'victim' }, { 'custom:role': 'admin' }, { 'custom:plan': 'enterprise' },
  ]) {
    const input = event('PreSignUp_SignUp');
    Object.assign(input.request.userAttributes, change);
    await assert.rejects(handler(input), /signup_/);
  }
});

test('IAM administrator creation remains compatible while external federation fails closed', async () => {
  const { createPreSignUpHandler } = await implementation();
  const handler = createPreSignUpHandler();
  const admin = event('PreSignUp_AdminCreateUser', { request: { userAttributes: { email: 'smoke@example.invalid' } } });
  assert.equal(await handler(admin), admin);
  await assert.rejects(handler(event('PreSignUp_ExternalProvider')), /signup_source/);
});

test('confirmed signup provisions an isolated coordinator workspace with server-owned pilot plan', async () => {
  const { createPostConfirmationHandler } = await implementation();
  const repo = repository();
  const handler = createPostConfirmationHandler({ repository: repo, now: () => new Date('2026-11-19T19:00:00Z') });
  const input = event('PostConfirmation_ConfirmSignUp');
  input.request.clientMetadata = { orgId: 'victim', role: 'admin', plan: 'enterprise' };
  assert.equal(await handler(input), input);
  assert.equal(repo.creations.length, 1);
  const { membership, organization } = repo.creations[0];
  assert.equal(membership.pk, `USER#${attributes.sub}`);
  assert.equal(membership.sk, 'MEMBERSHIP');
  assert.match(membership.orgId, /^org_[a-f0-9]{32}$/);
  assert.notEqual(membership.orgId, 'victim');
  assert.equal(membership.sites.length, 1);
  assert.match(membership.sites[0].id, /^site_[a-f0-9]{32}$/);
  assert.deepEqual({ ...membership.sites[0], id: undefined }, { id: undefined, name: 'Sede Norte', timeZone: 'America/Mexico_City', role: 'coordinator' });
  assert.equal(organization.pk, `ORG#${membership.orgId}`);
  assert.equal(organization.sk, 'META');
  assert.equal(organization.ownerSub, attributes.sub);
  assert.equal(organization.plan, 'pilot');
  assert.equal(organization.status, 'active');
  assert.equal(organization.name, 'Operación de prueba');
  assert.equal(organization.createdAt, '2026-11-19T19:00:00.000Z');
});

test('replayed and concurrent confirmation preserve the original workspace', async () => {
  const { createPostConfirmationHandler } = await implementation();
  const repo = repository();
  const handler = createPostConfirmationHandler({ repository: repo });
  await Promise.all(Array.from({ length: 5 }, () => handler(event('PostConfirmation_ConfirmSignUp'))));
  assert.equal(repo.creations.length, 1);
  const original = structuredClone(repo.creations[0]);
  const repeated = event('PostConfirmation_ConfirmSignUp');
  repeated.request.userAttributes['custom:siteName'] = 'Changed name';
  await handler(repeated);
  assert.deepEqual(repo.creations[0], original);
});

test('a different verified subject receives different tenant and site identifiers', async () => {
  const { createPostConfirmationHandler } = await implementation();
  const repo = repository();
  const handler = createPostConfirmationHandler({ repository: repo });
  await handler(event('PostConfirmation_ConfirmSignUp'));
  const other = event('PostConfirmation_ConfirmSignUp');
  other.request.userAttributes.sub = 'other-subject';
  await handler(other);
  assert.notEqual(repo.creations[0].membership.orgId, repo.creations[1].membership.orgId);
  assert.notEqual(repo.creations[0].membership.sites[0].id, repo.creations[1].membership.sites[0].id);
});

test('existing administrative memberships never move or acquire elevated roles during signup replay', async () => {
  const { createPostConfirmationHandler } = await implementation();
  const repo = repository();
  const existing = { pk: `USER#${attributes.sub}`, sk: 'MEMBERSHIP', orgId: 'assigned-org', sites: [{ id: 'assigned-site', role: 'technician', name: 'Assigned', timeZone: 'UTC' }] };
  repo.rows.set(existing.pk, structuredClone(existing));
  await createPostConfirmationHandler({ repository: repo })(event('PostConfirmation_ConfirmSignUp'));
  assert.equal(repo.creations.length, 0);
  assert.deepEqual(repo.rows.get(existing.pk), existing);
});

test('unverified, malformed and HTTP-spoofed confirmation cannot provision data', async () => {
  const { createPostConfirmationHandler } = await implementation();
  const repo = repository();
  const handler = createPostConfirmationHandler({ repository: repo });
  for (const change of [{ email_verified: 'false' }, { email_verified: true }, { sub: '' }, { sub: '../victim' }, { 'custom:siteName': '' }]) {
    const input = event('PostConfirmation_ConfirmSignUp');
    Object.assign(input.request.userAttributes, change);
    await assert.rejects(handler(input), /signup_/);
  }
  await assert.rejects(handler(event('PostConfirmation_ConfirmSignUp', { requestContext: {} })), /signup_event/);
  assert.equal(repo.creations.length, 0);
});

test('password recovery confirmation never creates or overwrites a workspace', async () => {
  const { createPostConfirmationHandler } = await implementation();
  const repo = repository();
  const handler = createPostConfirmationHandler({ repository: repo });
  const input = event('PostConfirmation_ConfirmForgotPassword', { request: {} });
  assert.equal(await handler(input), input);
  assert.equal(repo.creations.length, 0);
});

test('a transient transaction conflict retries without changing generated workspace identifiers', async () => {
  const { createPostConfirmationHandler } = await implementation();
  const attempted = [];
  const repo = { getMembership: async () => undefined, createWorkspace: async (workspace) => { attempted.push(structuredClone(workspace)); if (attempted.length === 1) throw Object.assign(condition(), { CancellationReasons: [{ Code: 'TransactionConflict' }] }); } };
  await createPostConfirmationHandler({ repository: repo })(event('PostConfirmation_ConfirmSignUp'));
  assert.equal(attempted.length, 2);
  assert.deepEqual(attempted[0], attempted[1]);
});

test('database failures fail closed with a non-personal diagnostic and never report successful activation', async () => {
  const { createPostConfirmationHandler } = await implementation();
  const repo = { getMembership: async () => undefined, createWorkspace: async () => { throw new Error('sensitive simulated database details'); } };
  await assert.rejects(createPostConfirmationHandler({ repository: repo })(event('PostConfirmation_ConfirmSignUp')), (error) => error.message === 'signup_workspace_pending');
});

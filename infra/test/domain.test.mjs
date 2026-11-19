import assert from 'node:assert/strict';
import { test } from 'node:test';

async function application() {
  let modules;
  try {
    modules = await Promise.all([
      import('../functions/domain/access.mjs'),
      import('../functions/domain/assets.mjs'),
      import('../functions/domain/inspections.mjs'),
      import('../functions/domain/memory.mjs'),
    ]);
  } catch (error) {
    assert.fail(`Domain services must be implemented: ${error.code}`);
  }
  const [{ createAccessHandler }, { createAssetsHandler }, { createInspectionsHandler }, { createMemoryRepositories }] = modules;
  const repositories = createMemoryRepositories({ memberships: [
    { orgId: 'org-a', sub: 'coordinator', sites: [{ id: 'north', name: 'Sede Norte', timeZone: 'America/Mexico_City', role: 'coordinator' }, { id: 'south', name: 'Sede Sur', timeZone: 'America/Mexico_City', role: 'coordinator' }] },
    { orgId: 'org-a', sub: 'technician', sites: [{ id: 'north', name: 'Sede Norte', timeZone: 'America/Mexico_City', role: 'technician' }] },
    { orgId: 'org-b', sub: 'other', sites: [{ id: 'north', name: 'Otra organización', timeZone: 'America/Mexico_City', role: 'coordinator' }] },
  ] });
  const access = createAccessHandler({ repository: repositories.access });
  const authorize = async (identity, siteId, allowedRoles) => {
    const response = await access({ internalAction: 'authorize', identity, siteId, allowedRoles });
    if (response.statusCode !== 200) {
      const error = new Error(JSON.parse(response.body).error);
      error.statusCode = response.statusCode;
      throw error;
    }
    return JSON.parse(response.body);
  };
  const assets = createAssetsHandler({ repository: repositories.assets, authorize });
  const getAsset = async (identity, siteId, assetId) => {
    const response = await assets({ internalAction: 'getAsset', identity, siteId, assetId });
    if (response.statusCode !== 200) {
      const error = new Error(JSON.parse(response.body).error);
      error.statusCode = response.statusCode;
      throw error;
    }
    return JSON.parse(response.body);
  };
  const inspections = createInspectionsHandler({ repository: repositories.inspections, authorize, getAsset, now: () => new Date('2026-11-19T18:00:00Z') });
  return { access, assets, inspections };
}

function request(method, path, body, options = {}) {
  const { actor = 'coordinator', orgId = 'org-a', key, query } = options;
  return { version: '2.0', rawPath: path, requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: actor, token_use: 'access' } } } }, headers: key ? { 'idempotency-key': key } : {}, queryStringParameters: query, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
const payload = (response) => JSON.parse(response.body);
const assetPath = '/api/v1/sites/north/assets';
const assetBody = { name: 'Refrigerador 1', type: 'Refrigeración', status: 'operational' };
async function addAsset(app, options = {}) {
  const response = await app.assets(request('POST', assetPath, assetBody, { key: 'asset-1', ...options }));
  assert.equal(response.statusCode, 201);
  return payload(response);
}

test('lists only assigned sites and rejects missing verified identity', async () => {
  const app = await application();
  assert.deepEqual(payload(await app.access(request('GET', '/api/v1/sites', undefined, { actor: 'technician' }))).items.map((site) => site.id), ['north']);
  assert.equal((await app.access({ rawPath: '/api/v1/sites', requestContext: { http: { method: 'GET' } }, headers: { authorization: 'Bearer invented' } })).statusCode, 401);
  assert.equal((await app.access(request('GET', '/api/v1/sites', undefined, { actor: 'unknown' }))).statusCode, 403);
  const idToken = request('GET', '/api/v1/sites');
  idToken.requestContext.authorizer.jwt.claims.token_use = 'id';
  assert.equal((await app.access(idToken)).statusCode, 401);
});

test('asset creation is atomic, idempotent and rejects changed reuse', async () => {
  const app = await application();
  const responses = await Promise.all(Array.from({ length: 5 }, () => app.assets(request('POST', assetPath, assetBody, { key: 'same' }))));
  assert.ok(responses.every((response) => response.statusCode === 201));
  assert.equal(new Set(responses.map((response) => payload(response).id)).size, 1);
  assert.equal(payload(await app.assets(request('GET', assetPath))).items.length, 1);
  assert.equal((await app.assets(request('POST', assetPath, { ...assetBody, name: 'Different' }, { key: 'same' }))).statusCode, 409);
});

test('authorization isolates organizations, sites and coordinator writes', async () => {
  const app = await application();
  const asset = await addAsset(app);
  assert.equal((await app.assets(request('POST', assetPath, assetBody, { actor: 'technician', key: 'denied' }))).statusCode, 403);
  assert.equal((await app.assets(request('GET', '/api/v1/sites/south/assets', undefined, { actor: 'technician' }))).statusCode, 404);
  assert.deepEqual(payload(await app.assets(request('GET', assetPath, undefined, { actor: 'other', orgId: 'org-b' }))).items, []);
  assert.equal((await app.inspections(request('GET', `${assetPath}/${asset.id}/inspections`, undefined, { actor: 'other', orgId: 'org-b' }))).statusCode, 404);
});

test('inspection schedule, pending list, completion and persisted history work', async () => {
  const app = await application();
  const asset = await addAsset(app);
  const path = `${assetPath}/${asset.id}/inspections`;
  const scheduled = await app.inspections(request('POST', path, { dueDate: '2026-11-20' }, { key: 'schedule-1' }));
  assert.equal(scheduled.statusCode, 201);
  const inspection = payload(scheduled);
  assert.equal(payload(await app.inspections(request('GET', '/api/v1/sites/north/inspections', undefined, { query: { status: 'pending', dueThrough: '2026-11-19' } }))).items.length, 0);
  assert.equal(payload(await app.inspections(request('GET', '/api/v1/sites/north/inspections', undefined, { actor: 'technician', query: { status: 'pending', dueThrough: '2026-11-20' } }))).items[0].id, inspection.id);
  const completionPath = `${path}/${inspection.id}/completion`;
  const completed = await app.inspections(request('PUT', completionPath, { result: 'attention', note: 'Revisar sello', completedBy: 'forged', completedAt: '1900-01-01' }, { actor: 'technician' }));
  assert.equal(completed.statusCode, 400);
  const accepted = await app.inspections(request('PUT', completionPath, { result: 'attention', note: 'Revisar sello' }, { actor: 'technician' }));
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(payload(accepted), { ...inspection, status: 'completed', result: 'attention', note: 'Revisar sello', completedAt: '2026-11-19T18:00:00.000Z', completedBy: 'technician' });
  assert.deepEqual(payload(await app.inspections(request('PUT', completionPath, { result: 'attention', note: 'Revisar sello' }, { actor: 'technician' }))), payload(accepted));
  assert.equal((await app.inspections(request('PUT', completionPath, { result: 'ok', note: '' }, { actor: 'technician' }))).statusCode, 409);
  assert.deepEqual(payload(await app.inspections(request('GET', path))).items, [payload(accepted)]);
  assert.deepEqual(payload(await app.inspections(request('GET', '/api/v1/sites/north/inspections', undefined, { query: { status: 'pending', dueThrough: '2026-11-20' } }))).items, []);
});

test('parallel conflicting completion persists exactly one result', async () => {
  const app = await application();
  const asset = await addAsset(app);
  const path = `${assetPath}/${asset.id}/inspections`;
  const inspection = payload(await app.inspections(request('POST', path, { dueDate: '2026-11-20' }, { key: 'one' })));
  const responses = await Promise.all(['ok', 'failed'].map((result) => app.inspections(request('PUT', `${path}/${inspection.id}/completion`, { result, note: '' }, { actor: 'technician' }))));
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409]);
});

test('scheduling enforces assignment, role, real dates and idempotency', async () => {
  const app = await application();
  const asset = await addAsset(app);
  const path = `${assetPath}/${asset.id}/inspections`;
  assert.equal((await app.inspections(request('POST', path, { dueDate: '2026-02-30' }, { key: 'invalid-date' }))).statusCode, 400);
  assert.equal((await app.inspections(request('POST', path, { dueDate: '2026-11-20' }, { actor: 'technician', key: 'forbidden' }))).statusCode, 403);
  const one = await app.inspections(request('POST', path, { dueDate: '2026-11-20' }, { key: 'once' }));
  assert.deepEqual(payload(await app.inspections(request('POST', path, { dueDate: '2026-11-20' }, { key: 'once' }))), payload(one));
  assert.equal((await app.inspections(request('POST', path, { dueDate: '2026-11-21' }, { key: 'once' }))).statusCode, 409);
  assert.equal((await app.inspections(request('GET', '/api/v1/sites/north/inspections', undefined, { query: { status: 'pending', dueThrough: 'not-a-date' } }))).statusCode, 400);
});

test('pagination cannot cross site, organization or query boundaries', async () => {
  const app = await application();
  await addAsset(app);
  await addAsset(app, { key: 'asset-2' });
  const first = payload(await app.assets(request('GET', assetPath, undefined, { query: { limit: '1' } })));
  assert.equal(first.items.length, 1);
  assert.ok(first.nextToken);
  const second = payload(await app.assets(request('GET', assetPath, undefined, { query: { limit: '1', nextToken: first.nextToken } })));
  assert.equal(second.items.length, 1);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal((await app.assets(request('GET', '/api/v1/sites/south/assets', undefined, { query: { nextToken: first.nextToken } }))).statusCode, 400);
  assert.equal((await app.assets(request('GET', assetPath, undefined, { actor: 'other', orgId: 'org-b', query: { nextToken: first.nextToken } }))).statusCode, 400);
});

test('invalid payloads, missing keys and body size are rejected', async () => {
  const app = await application();
  assert.equal((await app.assets(request('POST', assetPath, assetBody))).statusCode, 400);
  assert.equal((await app.assets(request('POST', assetPath, { ...assetBody, name: 'x'.repeat(121) }, { key: 'long' }))).statusCode, 400);
  assert.equal((await app.assets(request('POST', assetPath, { ...assetBody, orgId: 'org-b' }, { key: 'forged' }))).statusCode, 400);
  assert.equal((await app.assets({ ...request('POST', assetPath, assetBody, { key: 'bad-json' }), body: '{' })).statusCode, 400);
  assert.equal((await app.assets({ ...request('POST', assetPath, assetBody, { key: 'large' }), body: ' '.repeat(17000) })).statusCode, 413);
});

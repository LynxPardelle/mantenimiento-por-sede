import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessHandler } from '../functions/domain/access.mjs';
import { createMemoryRepositories } from '../functions/domain/memory.mjs';
import { HttpError } from '../functions/domain/common.mjs';

const route = '/api/v1/sites/north/pilot';
const nowInitial = '2026-11-20T00:00:00.000Z';
const input = () => ({ expectedRevision: 0, startDate: '2026-11-20', scope: { description: 'Equipos de la sede inicial.', assetScope: 'all-site-assets', coordinators: 1, technicians: 0 }, goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 }, baseline: { weekStartDate: '2026-11-01', historyProtocol: 'Buscar el último resultado del mismo equipo.', historyAttempts: [{ success: true, seconds: 40 }, { success: false, seconds: 120 }, { success: true, seconds: 20 }], effortMinutes: { preparation: 15, recording: 10, assistance: 0 }, noteUsefulnessCriterion: 'Describe revisión y resultado observado.' } });
const confirmation = expectedRevision => ({ expectedRevision, agreements: { realOperation: true, authority: true, measurement: true } });
const request = (method, body, actor = 'coordinator', path = route) => ({ version: '2.0', rawPath: path, requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: actor, token_use: 'access' } } } }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const body = response => JSON.parse(response.body);

async function application({ environment = 'production', technical = false } = {}) {
  let modules;
  try { modules = await Promise.all([import('../functions/domain/pilot.mjs'), import('../functions/domain/pilot-export.mjs'), import('../functions/domain/pilot-memory.mjs')]); }
  catch (error) { assert.fail(`Pilot handlers must exist: ${error.code}`); }
  const memberships = [
    { sub: 'coordinator', orgId: 'org-a', sites: [{ id: 'north', name: 'Norte', timeZone: 'America/Mexico_City', role: 'coordinator' }] },
    { sub: 'technician', orgId: 'org-a', sites: [{ id: 'north', name: 'Norte', timeZone: 'America/Mexico_City', role: 'technician' }] },
    { sub: 'other', orgId: 'org-b', sites: [{ id: 'north', name: 'Otra operación', timeZone: 'America/Mexico_City', role: 'coordinator' }] },
  ];
  const access = createAccessHandler({ repository: createMemoryRepositories({ memberships }).access });
  const repository = modules[2].createMemoryPilotRepository();
  let clock = new Date(nowInitial);
  const authorize = async (identity, siteId, allowedRoles) => {
    const result = await access({ internalAction: 'authorize', identity, siteId, allowedRoles });
    if (result.statusCode !== 200) throw new HttpError(result.statusCode, body(result).error);
    return { ...body(result), dataClass: technical ? 'technical' : 'unclassified' };
  };
  return { api: modules[0].createPilotHandler({ repository, authorize, now: () => clock, environment }), exporter: modules[1].createPilotExportHandler({ repository }), repository, advance: value => { clock = new Date(value); } };
}

test('pilot context uses assigned site and its local calendar, without creating enrollment', async () => {
  const app = await application();
  const response = await app.api(request('GET'));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(body(response), { site: { id: 'north', name: 'Norte', timeZone: 'America/Mexico_City', role: 'coordinator' }, earliestStartDate: '2026-11-20', latestStartDate: '2027-02-17', latestBaselineWeekStartDate: '2026-11-12', classification: 'enrolled-real', enrollment: null });
  assert.equal(await app.repository.get({ orgId: 'org-a', siteId: 'north' }), undefined);
  assert.equal((await app.repository.exportRegistry()).cohorts.length, 0);
});

test('draft allows explicit missing baseline values, then saves completed data with stable retries', async () => {
  const app = await application();
  const missing = input(); missing.startDate = ''; missing.scope.description = ''; missing.scope.coordinators = null; missing.scope.technicians = null;
  missing.goals.onTimeRateTarget = null; missing.goals.minimumDueInspections = null;
  missing.baseline.weekStartDate = ''; missing.baseline.historyProtocol = ''; missing.baseline.historyAttempts = [{ success: null, seconds: null }]; missing.baseline.effortMinutes = { preparation: null, recording: null, assistance: null }; missing.baseline.noteUsefulnessCriterion = '';
  const saved = await app.api(request('PUT', missing));
  assert.equal(saved.statusCode, 200);
  assert.equal(body(saved).revision, 1);
  assert.equal(body(saved).baseline.historyAttempts[0].success, null);
  assert.equal((await app.api(request('POST', confirmation(1), 'coordinator', route + '/enrollment'))).statusCode, 400);
  const completedInput = { ...input(), expectedRevision: 1 };
  const completed = await app.api(request('PUT', completedInput));
  assert.equal(completed.statusCode, 200);
  assert.equal(body(completed).revision, 2);
  app.advance('2026-11-20T01:00:00Z');
  assert.deepEqual(body(await app.api(request('PUT', completedInput))), body(completed));
  const conflict = { ...completedInput, scope: { ...completedInput.scope, description: 'Una modificación distinta.' } };
  assert.equal((await app.api(request('PUT', conflict))).statusCode, 409);
});

test('confirmed enrollment fixes identity, classification and agreement time, and exports no free text or actors', async () => {
  const app = await application();
  await app.api(request('PUT', input()));
  const enrolled = await app.api(request('POST', confirmation(1), 'coordinator', route + '/enrollment'));
  assert.equal(enrolled.statusCode, 200);
  assert.equal(body(enrolled).status, 'enrolled');
  assert.equal(body(enrolled).revision, 2);
  assert.equal(body(enrolled).classification, 'enrolled-real');
  assert.equal(body(enrolled).timeZone, 'America/Mexico_City');
  assert.equal(body(enrolled).agreedAt, nowInitial);
  assert.match(body(enrolled).code, /^pilot-[a-f0-9]{24}$/);
  assert.ok(!JSON.stringify(body(enrolled)).includes('createdBy'));
  assert.ok(!JSON.stringify(body(enrolled)).includes('confirmedBy'));
  assert.ok(!JSON.stringify(body(enrolled)).includes('lastFingerprint'));
  app.advance('2026-12-31T00:00:00Z');
  assert.deepEqual(body(await app.api(request('POST', confirmation(1), 'coordinator', route + '/enrollment'))), body(enrolled));
  assert.equal((await app.api(request('PUT', { ...input(), expectedRevision: 2 }))).statusCode, 409);
  const exported = body(await app.exporter({ internalAction: 'exportPilotRegistry' }));
  assert.equal(exported.cohorts[0].orgId, 'org-a');
  assert.equal(exported.cohorts[0].siteId, 'north');
  assert.equal(exported.baselines[0].historyLookup.medianSuccessfulSeconds, 30);
  assert.deepEqual(exported.baselines[0].historyLookup, { attempts: 3, successful: 2, failed: 1, medianSuccessfulSeconds: 30 });
  assert.equal(exported.baselines[0].qualityCriterionCaptured, true);
  assert.deepEqual(exported.baselines[0].period, { startDate: '2026-11-01', endDateExclusive: '2026-11-08', timeZone: 'America/Mexico_City' });
  assert.equal(exported.baselines[0].source, 'participant-declared');
  for (const hidden of [input().scope.description, input().baseline.historyProtocol, input().baseline.noteUsefulnessCriterion, 'coordinator', 'createdBy', 'confirmedBy']) {
    if (hidden === 'coordinator') continue;
    assert.ok(!JSON.stringify(exported).includes(hidden));
  }
});

test('technical environments and server-marked technical fixtures never create real cohorts', async () => {
  for (const options of [{ environment: 'development' }, { environment: 'testing' }, { environment: 'production', technical: true }]) {
    const app = await application(options);
    await app.api(request('PUT', input()));
    assert.equal(body(await app.api(request('POST', confirmation(1), 'coordinator', route + '/enrollment'))).classification, 'technical');
  }
});

test('coordinator authority and organization isolation apply to reads and all writes', async () => {
  const app = await application();
  for (const method of ['GET', 'PUT', 'POST']) {
    const path = method === 'POST' ? route + '/enrollment' : route;
    const data = method === 'GET' ? undefined : method === 'PUT' ? input() : confirmation(1);
    assert.equal((await app.api(request(method, data, 'technician', path))).statusCode, 403);
    assert.equal((await app.api(request(method, data, 'coordinator', path.replace('north', 'unassigned')))).statusCode, 404);
  }
  await app.api(request('PUT', input()));
  assert.equal(body(await app.api(request('GET', undefined, 'other'))).enrollment, null);
  assert.equal((await app.api(request('POST', confirmation(1), 'other', route + '/enrollment'))).statusCode, 409);
  const idToken = request('GET'); idToken.requestContext.authorizer.jwt.claims.token_use = 'id';
  assert.equal((await app.api(idToken)).statusCode, 401);
  assert.equal((await app.api({ internalAction: 'exportPilotRegistry', identity: { sub: 'coordinator' } })).statusCode, 401);
});

test('strict payload and date bounds reject privilege injection, invalid baseline and fabricated agreement', async () => {
  const app = await application();
  const bads = [
    { ...input(), orgId: 'org-b' }, { ...input(), classification: 'enrolled-real' }, { ...input(), timeZone: 'UTC' }, { ...input(), expectedRevision: -1 },
    { ...input(), scope: { ...input().scope, orgId: 'evil' } },
    { ...input(), goals: { ...input().goals, minimumDueInspections: 0 } },
    { ...input(), baseline: { ...input().baseline, historyAttempts: [{ success: 'yes', seconds: 1 }] } },
    { ...input(), baseline: { ...input().baseline, historyAttempts: [{ success: true, seconds: -1 }] } },
    { ...input(), baseline: { ...input().baseline, effortMinutes: { preparation: 1, recording: 1, assistance: 10081 } } },
  ];
  for (const bad of bads) assert.equal((await app.api(request('PUT', bad))).statusCode, 400);
  await app.api(request('PUT', input()));
  for (const agreements of [{ realOperation: true, authority: true, measurement: false }, { realOperation: true, authority: true, measurement: true, billing: true }]) {
    assert.equal((await app.api(request('POST', { expectedRevision: 1, agreements }, 'coordinator', route + '/enrollment'))).statusCode, 400);
  }
  app.advance('2026-11-20T18:00:00Z');
  assert.equal((await app.api(request('POST', confirmation(1), 'coordinator', route + '/enrollment'))).statusCode, 400);
});

test('HTTP-shaped or caller-supplied export events are rejected and repository failures remain generic', async () => {
  const app = await application();
  for (const event of [{ internalAction: 'exportPilotRegistry', requestContext: {} }, { internalAction: 'exportPilotRegistry', rawPath: route }, { internalAction: 'exportPilotRegistry', version: '2.0' }, { internalAction: 'exportPilotRegistry', cohorts: [] }]) assert.equal((await app.exporter(event)).statusCode, 404);
  const { createPilotExportHandler } = await import('../functions/domain/pilot-export.mjs');
  const broken = createPilotExportHandler({ repository: { exportRegistry: async () => { throw new Error('private actor or note'); } } });
  const failure = await broken({ internalAction: 'exportPilotRegistry' });
  assert.equal(failure.statusCode, 500);
  assert.deepEqual(body(failure), { error: 'internal_error' });
});

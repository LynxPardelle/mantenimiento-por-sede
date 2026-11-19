import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aws, stackOutputs } from './aws.mjs';

// Only disposable identities/data in a fresh smoke namespace; never tenant data.
const args = process.argv.slice(2);
const environment = args.includes('--environment') ? args[args.indexOf('--environment') + 1] : 'development';
if (!['development', 'testing', 'production'].includes(environment)) throw new Error('Ambiente no válido.');
const region = 'us-east-1';
const prefix = `sedepulso-${environment}`;
const platform = stackOutputs(`${prefix}-platform`);
const inventory = stackOutputs(`${prefix}-assets`);
const maintenance = stackOutputs(`${prefix}-inspections`);
const frontend = stackOutputs(`${prefix}-frontend`);
const base = frontend.AppUrl;
const suffix = randomUUID().slice(0, 8);
const orgA = `smoke-a-${suffix}`;
const orgB = `smoke-b-${suffix}`;
const users = [];
const assetIds = [];
const checks = [];
const cliRegion = ['--region', region];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function api(path, { token, method = 'GET', body, key } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); } catch { value = text; }
  return { status: response.status, value, headers: response.headers };
}
const expect = (response, status, description) => {
  assert.equal(response.status, status, `${description}: HTTP ${response.status}, ${JSON.stringify(response.value).slice(0, 300)}`);
  checks.push(description);
  return response.value;
};
async function identity(role, organization, sites) {
  const username = `smoke-${role}-${suffix}@example.invalid`;
  const created = aws(['cognito-idp', 'admin-create-user', ...cliRegion, '--user-pool-id', platform.UserPoolId, '--username', username, '--message-action', 'SUPPRESS', '--user-attributes', `Name=email,Value=${username}`]);
  const sub = created.User.Attributes.find(({ Name }) => Name === 'sub').Value;
  const user = { username, sub };
  users.push(user);
  const password = `Sp1!${randomBytes(24).toString('base64url')}`;
  aws(['cognito-idp', 'admin-set-user-password', ...cliRegion, '--user-pool-id', platform.UserPoolId, '--username', username, '--password', password, '--permanent']);
  const auth = aws(['cognito-idp', 'admin-initiate-auth', ...cliRegion, '--user-pool-id', platform.UserPoolId, '--client-id', platform.ClientId, '--auth-flow', 'ADMIN_USER_PASSWORD_AUTH', '--auth-parameters', JSON.stringify({ USERNAME: username, PASSWORD: password })]);
  user.token = auth.AuthenticationResult.AccessToken;
  user.idToken = auth.AuthenticationResult.IdToken;
  const item = {
    pk: { S: `USER#${sub}` }, sk: { S: 'MEMBERSHIP' }, orgId: { S: organization },
    sites: { L: sites.map(({ id, role }) => ({ M: { id: { S: id }, name: { S: `Prueba ${id}` }, timeZone: { S: 'America/Mexico_City' }, role: { S: role } } })) },
  };
  aws(['dynamodb', 'put-item', ...cliRegion, '--table-name', platform.AccessTableName, '--item', JSON.stringify(item), '--condition-expression', 'attribute_not_exists(pk)']);
  return user;
}
async function deletePartition(table, partition) {
  const { Items = [] } = aws(['dynamodb', 'query', ...cliRegion, '--table-name', table, '--key-condition-expression', 'pk = :pk', '--expression-attribute-values', JSON.stringify({ ':pk': { S: partition } }), '--projection-expression', 'pk, sk', '--consistent-read']);
  for (const key of Items) aws(['dynamodb', 'delete-item', ...cliRegion, '--table-name', table, '--key', JSON.stringify(key)]);
}

try {
  expect(await api('/api/health'), 200, 'salud pública por CloudFront');
  const config = expect(await api('/api/config'), 200, 'configuración pública sin secretos');
  assert.equal(config.authMode, 'cognito');
  expect(await api('/api/v1/sites'), 401, 'token ausente');
  expect(await api('/api/v1/sites', { token: 'invalid' }), 401, 'token inválido');
  const coordinator = await identity('coordinator', orgA, [{ id: 'north', role: 'coordinator' }, { id: 'south', role: 'coordinator' }]);
  const technician = await identity('technician', orgA, [{ id: 'north', role: 'technician' }]);
  const other = await identity('other', orgB, [{ id: 'north', role: 'coordinator' }]);
  expect(await api('/api/v1/sites', { token: coordinator.idToken }), 401, 'ID token rechazado por el servicio');
  assert.equal(expect(await api('/api/v1/sites', { token: coordinator.token }), 200, 'sedes del coordinador').items.length, 2);
  assert.equal(expect(await api('/api/v1/sites', { token: technician.token }), 200, 'sedes del técnico').items.length, 1);
  const path = '/api/v1/sites/north/assets';
  const body = { name: 'Equipo de prueba automática', type: 'Refrigeración', status: 'operational' };
  expect(await api(path, { token: technician.token, method: 'POST', body, key: 'denied' }), 403, 'rol insuficiente');
  expect(await api('/api/v1/sites/south/assets', { token: technician.token }), 404, 'sede no asignada');
  const created = await Promise.all(Array.from({ length: 3 }, () => api(path, { token: coordinator.token, method: 'POST', body, key: 'same' })));
  const asset = expect(created[0], 201, 'alta transaccional');
  assetIds.push(asset.id);
  for (const response of created) { assert.equal(response.status, 201); assert.equal(response.value.id, asset.id); }
  checks.push('alta concurrente idempotente');
  expect(await api(path, { token: coordinator.token, method: 'POST', body: { ...body, name: 'Otro contenido' }, key: 'same' }), 409, 'conflicto de idempotencia');
  const second = expect(await api(path, { token: coordinator.token, method: 'POST', body, key: 'second' }), 201, 'segundo equipo');
  assetIds.push(second.id);
  assert.equal(expect(await api(path, { token: other.token }), 200, 'organizaciones aisladas').items.length, 0);
  const page = expect(await api(`${path}?limit=1`, { token: coordinator.token }), 200, 'paginación por sede');
  assert.equal(page.items.length, 1);
  assert.ok(page.nextToken);
  const next = expect(await api(`${path}?limit=1&nextToken=${encodeURIComponent(page.nextToken)}`, { token: coordinator.token }), 200, 'siguiente página');
  assert.notEqual(next.items[0].id, page.items[0].id);
  expect(await api(`${path}?nextToken=${encodeURIComponent(page.nextToken)}`, { token: other.token }), 400, 'cursor de otra organización rechazado');
  const historyPath = `${path}/${asset.id}/inspections`;
  expect(await api(historyPath, { token: other.token }), 404, 'equipo de otra organización oculto');
  const inspection = expect(await api(historyPath, { token: coordinator.token, method: 'POST', body: { dueDate: today }, key: 'inspection' }), 201, 'programación persistida');
  const completionPath = `${historyPath}/${inspection.id}/completion`;
  const pendingPath = `/api/v1/sites/north/inspections?status=pending&dueThrough=${today}`;
  let pending;
  for (let attempt = 0; attempt < 10; attempt++) {
    pending = await api(pendingPath, { token: technician.token });
    if (pending.value.items?.some(({ id }) => id === inspection.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(expect(pending, 200, 'pendientes desde el índice').items.some(({ id }) => id === inspection.id));
  const completions = await Promise.all(['ok', 'failed'].map((result) => api(completionPath, { token: technician.token, method: 'PUT', body: { result, note: 'Evidencia de prueba' } })));
  assert.deepEqual(completions.map(({ status }) => status).sort(), [200, 409]);
  checks.push('cierres concurrentes: un éxito y un conflicto');
  const completed = completions.find(({ status }) => status === 200).value;
  assert.equal(completed.completedBy, technician.sub);
  assert.ok(!Number.isNaN(Date.parse(completed.completedAt)));
  const repeated = expect(await api(completionPath, { token: technician.token, method: 'PUT', body: { result: completed.result, note: completed.note } }), 200, 'reintento de cierre estable');
  assert.deepEqual(repeated, completed);
  assert.deepEqual(expect(await api(historyPath, { token: coordinator.token }), 200, 'historial persistido').items, [completed]);
  const html = await fetch(base, { signal: AbortSignal.timeout(30000) });
  assert.equal(html.status, 200);
  assert.match(await html.text(), /SedePulso/);
  checks.push('HTML Angular SSR público');
} finally {
  const cleanupErrors = [];
  const cleanup = async (action) => { try { await action(); } catch (error) { cleanupErrors.push(error.message); } };
  for (const id of assetIds) await cleanup(() => deletePartition(maintenance.InspectionsTableName, `ORG#${orgA}#SITE#north#ASSET#${id}`));
  for (const org of [orgA, orgB]) {
    await cleanup(() => deletePartition(inventory.AssetsTableName, `ORG#${org}#SITE#north`));
    await cleanup(() => deletePartition(maintenance.InspectionsTableName, `ORG#${org}#SITE#north`));
  }
  for (const user of users) {
    await cleanup(() => aws(['dynamodb', 'delete-item', ...cliRegion, '--table-name', platform.AccessTableName, '--key', JSON.stringify({ pk: { S: `USER#${user.sub}` }, sk: { S: 'MEMBERSHIP' } })]));
    await cleanup(() => aws(['cognito-idp', 'admin-delete-user', ...cliRegion, '--user-pool-id', platform.UserPoolId, '--username', user.username]));
  }
  if (cleanupErrors.length) throw new Error(`Falló limpieza de identidades/datos de prueba: ${cleanupErrors.join('; ')}`);
}
const report = { product: 'SedePulso', environment, url: base, checkedAt: new Date().toISOString(), checks, disposableIdentitiesDeleted: users.length };
await writeFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.artifacts', `smoke-${environment}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

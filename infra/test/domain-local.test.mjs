import assert from 'node:assert/strict';
import { test } from 'node:test';

test('local demo explicitly advertises demo auth and supports the complete HTTP flow', async () => {
  let module;
  try { module = await import('../tools/serve-local.mjs'); }
  catch (error) { assert.fail(`Local adapter must be importable: ${error.message}`); }
  assert.equal(typeof module.createLocalServer, 'function', 'Local adapter must export a testable server without starting it on import');
  const server = await module.createLocalServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { authMode: 'demo' });
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    const sites = await (await fetch(`${base}/api/v1/sites`)).json();
    assert.equal(sites.items.length, 2);
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'local-http' };
    const assetResponse = await fetch(`${base}/api/v1/sites/north/assets`, { method: 'POST', headers, body: JSON.stringify({ name: 'Local freezer', type: 'cold' }) });
    assert.equal(assetResponse.status, 201);
    const asset = await assetResponse.json();
    const scheduled = await fetch(`${base}/api/v1/sites/north/assets/${asset.id}/inspections`, { method: 'POST', headers, body: JSON.stringify({ dueDate: '2026-11-20' }) });
    assert.equal(scheduled.status, 201);
    const inspection = await scheduled.json();
    const completed = await fetch(`${base}/api/v1/sites/north/assets/${asset.id}/inspections/${inspection.id}/completion`, { method: 'PUT', headers, body: JSON.stringify({ result: 'ok', note: 'HTTP flow' }) });
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).completedBy, 'demo-coordinator');
    const history = await (await fetch(`${base}/api/v1/sites/north/assets/${asset.id}/inspections`)).json();
    assert.equal(history.items[0].status, 'completed');
    const badOrigin = await fetch(`${base}/api/v1/sites/north/assets`, { method: 'POST', headers: { ...headers, origin: 'https://unrelated.example' }, body: JSON.stringify({ name: 'Cross-site', type: 'cold' }) });
    assert.equal(badOrigin.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('local demo allows only the selected frontend port and rejects invalid ports', async () => {
  const { createLocalServer } = await import('../tools/serve-local.mjs');
  for (const frontendPort of [0, 65536, 4217.5, '4217.0', 'https://localhost:4217', 'other', '']) {
    await assert.rejects(createLocalServer({ frontendPort }), /frontend.*port|puerto/i);
  }
  const server = await createLocalServer({ frontendPort: '4217' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/config`, { headers: { origin: 'http://localhost:4217' } })).status, 200);
    assert.equal((await fetch(`${base}/api/config`, { headers: { origin: 'http://127.0.0.1:4217' } })).status, 200);
    assert.equal((await fetch(`${base}/api/config`, { headers: { origin: 'http://localhost:4200' } })).status, 403);
    assert.equal((await fetch(`${base}/api/config`, { headers: { origin: 'http://localhost:4218' } })).status, 403);
    assert.equal((await fetch(`${base}/api/config`, { headers: { origin: 'https://localhost:4217' } })).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

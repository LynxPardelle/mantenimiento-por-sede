import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handler as health } from '../functions/health/index.mjs';
import { createAccessHandler } from '../functions/domain/access.mjs';
import { createAssetsHandler } from '../functions/domain/assets.mjs';
import { createInspectionsHandler } from '../functions/domain/inspections.mjs';
import { createMemoryRepositories } from '../functions/domain/memory.mjs';
import { createPilotHandler } from '../functions/domain/pilot.mjs';
import { createMemoryPilotRepository } from '../functions/domain/pilot-memory.mjs';

const hostname = '127.0.0.1';
const port = 4301;

export async function createDemoHandler({ now = () => new Date() } = {}) {
  const repositories = createMemoryRepositories({ memberships: [
    { sub: 'demo-coordinator', orgId: 'org-demo', sites: [
      { id: 'north', name: 'Sede Norte', timeZone: 'America/Mexico_City', role: 'coordinator' },
      { id: 'south', name: 'Sede Sur', timeZone: 'America/Mexico_City', role: 'coordinator' },
    ] },
    { sub: 'other-coordinator', orgId: 'org-other', sites: [{ id: 'north', name: 'Sede ajena', timeZone: 'America/Mexico_City', role: 'coordinator' }] },
  ] });
  const access = createAccessHandler({ repository: repositories.access });
  const unwrap = async (promise) => {
    const result = await promise;
    const body = JSON.parse(result.body);
    if (result.statusCode >= 400) throw Object.assign(new Error(body.error), { statusCode: result.statusCode });
    return body;
  };
  const authorize = (identity, siteId, allowedRoles) => unwrap(access({ internalAction: 'authorize', identity, siteId, allowedRoles }));
  const assets = createAssetsHandler({ repository: repositories.assets, authorize });
  const getAsset = (identity, siteId, assetId) => unwrap(assets({ internalAction: 'getAsset', identity, siteId, assetId }));
  const inspections = createInspectionsHandler({ repository: repositories.inspections, authorize, getAsset });
  const pilot = createPilotHandler({ repository: createMemoryPilotRepository(), authorize, environment: 'development', now });
  const event = (method, rawPath, body, key) => ({ version: '2.0', rawPath, requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: 'demo-coordinator', token_use: 'access' } } } }, headers: key ? { 'idempotency-key': key } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const [siteId, name] of [['north', 'Refrigerador de mostrador'], ['south', 'Congelador principal']]) {
    const base = `/api/v1/sites/${siteId}/assets`;
    const asset = await unwrap(assets(event('POST', base, { name, type: 'Refrigeración comercial', status: 'operational' }, 'demo-seed')));
    await unwrap(inspections(event('POST', `${base}/${asset.id}/inspections`, { dueDate: today }, 'demo-seed')));
  }
  return (event) => event.rawPath === '/api/v1/sites' ? access(event) : /\/pilot(?:\/|$)/.test(event.rawPath) ? pilot(event) : /\/assets$/.test(event.rawPath) ? assets(event) : inspections(event);
}

export async function createLocalServer({ frontendPort = process.env.SEDEPULSO_FRONTEND_PORT ?? 4200, now } = {}) {
  if (!/^[0-9]{1,5}$/.test(String(frontendPort)) || !Number.isInteger(Number(frontendPort)) || Number(frontendPort) < 1 || Number(frontendPort) > 65535) {
    throw new Error('El puerto del frontend local debe ser un entero de 1 a 65535.');
  }
  frontendPort = Number(frontendPort);
  const domain = await createDemoHandler({ now });
  const server = createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
    try {
      // The unauthenticated demo is loopback-only and has no CORS. The fixed
      // development origins and host names also prevent cross-site writes.
      const allowedHosts = [`127.0.0.1:${frontendPort}`, `localhost:${frontendPort}`, `127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`];
      if (!allowedHosts.includes(request.headers.host)) return send(403, { error: 'local_host_required' });
      const allowedOrigins = allowedHosts.map((host) => `http://${host}`);
      if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) return send(403, { error: 'local_origin_required' });
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const result = await health();
        response.writeHead(result.statusCode, result.headers); response.end(result.body); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/config') return send(200, { authMode: 'demo' });
      if (!url.pathname.startsWith('/api/v1/')) return send(404, { error: 'not_found' });
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) return send(413, { error: 'payload_too_large' });
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const result = await domain({ version: '2.0', rawPath: url.pathname, requestContext: { http: { method: request.method }, authorizer: { jwt: { claims: { sub: 'demo-coordinator', token_use: 'access' } } } }, headers: request.headers, queryStringParameters: Object.fromEntries(url.searchParams), body });
      response.writeHead(result.statusCode, result.headers); response.end(result.body);
    } catch { send(500, { error: 'internal_error' }); }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = process.argv.indexOf('--frontend-port');
  if (option !== -1 && process.argv[option + 1] === undefined) throw new Error('--frontend-port requiere un puerto de 1 a 65535.');
  const server = await createLocalServer(option === -1 ? {} : { frontendPort: process.argv[option + 1] });
  server.listen(port, hostname, () => console.log(`SedePulso DEMO local en http://${hostname}:${port}; datos en memoria, sesión fija demo-coordinator.`));
}

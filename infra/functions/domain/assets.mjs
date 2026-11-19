import { ulid } from 'ulid';
import { digest, fail, guarded, httpRoute, identifier, identityOf, idempotencyKey, internalRequest, jsonBody, pageOptions, pageResult, response, scopeFor, text } from './common.mjs';

export function createAssetsHandler({ repository, authorize, idGenerator = ulid }) {
  return guarded(async (event) => {
    const internal = internalRequest(event, 'getAsset');
    const identity = identityOf(event, internal);
    const route = internal ? { match: [null, event.siteId], method: 'INTERNAL' } : httpRoute(event, /^\/api\/v1\/sites\/([A-Za-z0-9_-]{1,128})\/assets$/);
    const siteId = identifier(route.match[1], 'site');
    const authorization = await authorize(identity, siteId, route.method === 'POST' ? ['coordinator'] : ['coordinator', 'technician']);
    const scope = scopeFor(authorization, siteId);
    if (internal) {
      const item = await repository.getAsset(scope, identifier(event.assetId, 'asset'));
      if (!item) fail(404, 'not_found');
      return response(200, item);
    }
    if (route.method === 'GET') {
      const context = { ...scope, kind: 'assets' };
      return response(200, pageResult(await repository.listAssets(scope, pageOptions(event, context)), context));
    }
    if (route.method !== 'POST') fail(405, 'method_not_allowed');
    const body = jsonBody(event, ['name', 'type', 'status']);
    const normalized = { name: text(body.name, 'name', 120), type: text(body.type, 'type', 80), status: body.status ?? 'operational' };
    if (!['operational', 'out_of_service'].includes(normalized.status)) fail(400, 'invalid_status');
    const item = await repository.createAsset({ scope, actor: identity.sub, operation: 'createAsset', key: idempotencyKey(event), fingerprint: digest(normalized), item: { id: idGenerator(), ...normalized } });
    return response(201, item);
  });
}

let production;
export async function handler(event) {
  production ??= Promise.all([import('./dynamodb.mjs'), import('./invoke.mjs')]).then(async ([{ createDynamoRepositories }, { invokeService }]) => createAssetsHandler({ repository: (await createDynamoRepositories()).assets, authorize: (identity, siteId, allowedRoles) => invokeService(process.env.ACCESS_FUNCTION_NAME, { internalAction: 'authorize', identity, siteId, allowedRoles }) }));
  return (await production)(event);
}

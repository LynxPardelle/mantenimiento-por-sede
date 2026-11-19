import { ulid } from 'ulid';
import { dateOnly, digest, fail, guarded, httpRoute, identifier, identityOf, idempotencyKey, jsonBody, pageOptions, pageResult, response, scopeFor, text } from './common.mjs';

export function createInspectionsHandler({ repository, authorize, getAsset, now = () => new Date(), idGenerator = ulid }) {
  return guarded(async (event) => {
    const identity = identityOf(event);
    const { match, method } = httpRoute(event, /^\/api\/v1\/sites\/([A-Za-z0-9_-]{1,128})(?:\/inspections|\/assets\/([A-Za-z0-9_-]{1,128})\/inspections(?:\/([A-Za-z0-9_-]{1,128})\/completion)?)$/);
    const [, siteId, assetId, inspectionId] = match;
    const authorization = await authorize(identity, siteId, method === 'POST' ? ['coordinator'] : ['coordinator', 'technician']);
    const scope = scopeFor(authorization, siteId);
    if (!assetId) {
      if (method !== 'GET') fail(405, 'method_not_allowed');
      const query = event.queryStringParameters ?? {};
      if (query.status !== 'pending') fail(400, 'invalid_status');
      const dueThrough = dateOnly(query.dueThrough, 'dueThrough');
      const context = { ...scope, kind: 'pending', dueThrough };
      return response(200, pageResult(await repository.listPending(scope, dueThrough, pageOptions(event, context)), context));
    }
    identifier(assetId, 'asset');
    await getAsset(identity, siteId, assetId);
    if (!inspectionId && method === 'GET') {
      const context = { ...scope, kind: 'history', assetId };
      return response(200, pageResult(await repository.listHistory(scope, assetId, pageOptions(event, context)), context));
    }
    if (!inspectionId && method === 'POST') {
      const body = jsonBody(event, ['dueDate']);
      const normalized = { dueDate: dateOnly(body.dueDate) };
      const item = await repository.createInspection({ scope, actor: identity.sub, operation: `schedule#${assetId}`, key: idempotencyKey(event), fingerprint: digest(normalized), item: { id: idGenerator(), assetId, ...normalized, status: 'pending' } });
      return response(201, item);
    }
    if (inspectionId && method === 'PUT') {
      const body = jsonBody(event, ['result', 'note']);
      if (!['ok', 'attention', 'failed'].includes(body.result)) fail(400, 'invalid_result');
      const completion = { result: body.result, note: text(body.note, 'note', 2000, { optional: true }), completedBy: identity.sub, completedAt: now().toISOString() };
      return response(200, await repository.completeInspection(scope, assetId, identifier(inspectionId, 'inspection'), completion));
    }
    fail(405, 'method_not_allowed');
  });
}

let production;
export async function handler(event) {
  production ??= Promise.all([import('./dynamodb.mjs'), import('./invoke.mjs')]).then(async ([{ createDynamoRepositories }, { invokeService }]) => createInspectionsHandler({ repository: (await createDynamoRepositories()).inspections, authorize: (identity, siteId, allowedRoles) => invokeService(process.env.ACCESS_FUNCTION_NAME, { internalAction: 'authorize', identity, siteId, allowedRoles }), getAsset: (identity, siteId, assetId) => invokeService(process.env.ASSETS_FUNCTION_NAME, { internalAction: 'getAsset', identity, siteId, assetId }) }));
  return (await production)(event);
}

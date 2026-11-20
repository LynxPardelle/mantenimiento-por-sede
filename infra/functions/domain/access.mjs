import { fail, guarded, httpRoute, identifier, identityOf, internalRequest, response } from './common.mjs';

export function createAccessHandler({ repository }) {
  return guarded(async (event) => {
    const internal = internalRequest(event, 'authorize');
    const identity = identityOf(event, internal);
    const membership = await repository.getMembership(identity.sub);
    if (!membership?.orgId || !Array.isArray(membership.sites)) fail(internal ? 404 : 403, 'membership_required');
    const sites = membership.sites.filter((site) => ['coordinator', 'technician'].includes(site.role)).map(({ id, name, timeZone, role }) => ({ id, name, timeZone, role }));
    if (!internal) {
      const { method } = httpRoute(event, /^\/api\/v1\/sites$/);
      if (method !== 'GET') fail(405, 'method_not_allowed');
      return response(200, { items: sites });
    }
    const siteId = identifier(event.siteId, 'site');
    const site = sites.find((entry) => entry.id === siteId);
    if (!site) fail(404, 'not_found');
    if (event.allowedRoles && (!Array.isArray(event.allowedRoles) || !event.allowedRoles.includes(site.role))) fail(403, 'forbidden');
    return response(200, { orgId: identifier(membership.orgId, 'organization'), site, dataClass: membership.dataClass === 'technical' ? 'technical' : 'unclassified' });
  });
}

let production;
export async function handler(event) {
  production ??= import('./dynamodb.mjs').then(async ({ createDynamoRepositories }) => createAccessHandler({ repository: (await createDynamoRepositories()).access }));
  return (await production)(event);
}

import { fail, guarded, httpRoute, identifier, identityOf, jsonBody, response, scopeFor } from './common.mjs';
import { enrollmentRecord, normalizePilotData, pilotAgreements, pilotClassification, pilotDates, pilotRevision, publicPilot } from './pilot-model.mjs';

export function createPilotHandler({ repository, authorize, now = () => new Date(), environment = process.env.ENVIRONMENT }) {
  if (!['development', 'testing', 'production'].includes(environment)) throw new Error('Pilot environment is not configured');
  return guarded(async event => {
    const identity = identityOf(event);
    const { method, match } = httpRoute(event, /^\/api\/v1\/sites\/([A-Za-z0-9_-]{1,128})\/pilot(\/enrollment)?$/);
    const siteId = identifier(match[1], 'site');
    const authorization = await authorize(identity, siteId, ['coordinator']);
    const scope = scopeFor(authorization, siteId);
    if (authorization.site.role !== 'coordinator') fail(403, 'forbidden');
    const currentTime = now();
    const dates = pilotDates(currentTime, authorization.site.timeZone);
    if (method === 'GET' && !match[2]) {
      const { id, name, timeZone, role } = authorization.site;
      return response(200, { site: { id, name, timeZone, role }, ...dates, classification: pilotClassification(environment, authorization.dataClass), enrollment: publicPilot(await repository.get(scope)) });
    }
    if (method === 'PUT' && !match[2]) {
      const input = jsonBody(event, ['expectedRevision', 'startDate', 'scope', 'goals', 'baseline']);
      const expectedRevision = pilotRevision(input.expectedRevision);
      const { expectedRevision: ignored, ...fields } = input;
      const data = { ...normalizePilotData(fields), timeZone: authorization.site.timeZone };
      return response(200, publicPilot(await repository.saveDraft({ scope, actor: identity.sub, expectedRevision, data, now: currentTime.toISOString() })));
    }
    if (method !== 'POST' || !match[2]) fail(405, 'method_not_allowed');
    const input = jsonBody(event, ['expectedRevision', 'agreements']);
    const expectedRevision = pilotRevision(input.expectedRevision);
    const agreements = pilotAgreements(input.agreements);
    const current = await repository.get(scope);
    if (!current) fail(409, 'pilot_draft_required');
    // The canonical confirmed version is returned even after its start date passes.
    if (current.status === 'enrolled') {
      if (current.confirmedFromRevision === expectedRevision) return response(200, publicPilot(current));
      fail(409, 'pilot_already_enrolled');
    }
    if (current.revision !== expectedRevision) fail(409, 'pilot_revision_conflict');
    if (current.timeZone !== authorization.site.timeZone) fail(409, 'pilot_site_context_changed');
    const data = normalizePilotData({ startDate: current.startDate, scope: current.scope, goals: current.goals, baseline: current.baseline }, { complete: true, dates });
    const prepared = enrollmentRecord({ scope, actor: identity.sub, current, data, now: currentTime.toISOString(), environment, dataClass: authorization.dataClass, agreements });
    return response(200, publicPilot(await repository.enroll({ scope, actor: identity.sub, expectedRevision, ...prepared })));
  });
}

let production;
export async function handler(event) {
  production ??= Promise.all([import('./pilot-repository.mjs'), import('./invoke.mjs')]).then(([{ createPilotRepository }, { invokeService }]) => createPilotHandler({ repository: createPilotRepository(), environment: process.env.ENVIRONMENT, authorize: (identity, siteId, allowedRoles) => invokeService(process.env.ACCESS_FUNCTION_NAME, { internalAction: 'authorize', identity, siteId, allowedRoles }) }));
  return (await production)(event);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessHandler } from '../functions/domain/access.mjs';

test('only Access server membership can mark technical provenance; public sites do not expose it', async () => {
  for (const marker of ['technical', undefined, 'enrolled-real']) {
    const handler = createAccessHandler({ repository: { getMembership: async () => ({ orgId: 'org', dataClass: marker, sites: [{ id: 'site', name: 'Site', timeZone: 'Etc/GMT+6', role: 'coordinator' }] }) } });
    const internal = JSON.parse((await handler({ internalAction: 'authorize', identity: { sub: 'actor' }, siteId: 'site' })).body);
    assert.equal(internal.dataClass, marker === 'technical' ? 'technical' : 'unclassified');
    const publicView = JSON.parse((await handler({ rawPath: '/api/v1/sites', requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: { sub: 'actor', token_use: 'access' } } } }, dataClass: 'technical' })).body);
    assert.ok(!JSON.stringify(publicView).includes('dataClass'));
  }
});

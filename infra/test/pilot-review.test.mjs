import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotHandler } from '../functions/domain/pilot.mjs';
import { createMemoryPilotRepository } from '../functions/domain/pilot-memory.mjs';
import { HttpError } from '../functions/domain/common.mjs';

const path = '/api/v1/sites/north/pilot';
const enrollment = () => ({
  expectedRevision: 0,
  startDate: '2026-11-20',
  scope: { description: 'Scope private', assetScope: 'all-site-assets', coordinators: 1, technicians: 0 },
  goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 },
  baseline: {
    weekStartDate: '2026-11-01',
    historyProtocol: 'Private protocol',
    historyAttempts: [
      { success: true, seconds: 60 },
      { success: false, seconds: 100 },
    ],
    effortMinutes: { preparation: 10, recording: 20, assistance: 0 },
    noteUsefulnessCriterion: 'Private criterion',
  },
});
const draft = () => ({
  expectedRevision: 0,
  sameProtocol: true,
  historyAttempts: [
    { success: true, seconds: 30 },
    { success: false, seconds: 60 },
  ],
  effortMinutes: { preparation: 5, recording: 10, assistance: 0 },
  noteAssessment: { reviewed: 2, useful: 1 },
  summary: 'Private findings',
  nextAction: 'Private next action',
});
const req = (method, body, suffix = '/reviews', actor = 'coordinator') => ({
  rawPath: path + suffix,
  requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: actor, token_use: 'access' } } } },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const value = (r) => JSON.parse(r.body);
async function app() {
  const repository = createMemoryPilotRepository();
  let clock = new Date('2026-11-19T18:00:00.000Z');
  let zone = 'America/Mexico_City';
  const api = createPilotHandler({
    repository,
    environment: 'production',
    now: () => clock,
    authorize: async (identity, siteId) => {
      if (identity.sub === 'technician') throw new HttpError(403, 'forbidden');
      if (siteId !== 'north') throw new HttpError(404, 'not_found');
      return {
        orgId: identity.sub === 'other' ? 'org-b' : 'org-a',
        site: { id: 'north', name: 'North', role: 'coordinator', timeZone: zone },
        dataClass: 'technical',
      };
    },
  });
  return {
    api,
    repository,
    at: (time) => (clock = new Date(time)),
    zone: (v) => (zone = v),
    async enroll() {
      assert.equal((await api(req('PUT', enrollment(), ''))).statusCode, 200);
      assert.equal(
        (
          await api(
            req(
              'POST',
              {
                expectedRevision: 1,
                agreements: { realOperation: true, authority: true, measurement: true },
              },
              '/enrollment',
            ),
          )
        ).statusCode,
        200,
      );
    },
  };
}
test('weekly context returns four server-derived local windows only after enrollment', async () => {
  const a = await app();
  assert.deepEqual(value(await a.api(req('GET'))).weeks, []);
  await a.enroll();
  const r = await a.api(req('GET'));
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  const c = value(r);
  assert.equal(c.weeks.length, 4);
  assert.deepEqual(c.weeks[0], {
    week: 1,
    period: { startDate: '2026-11-20', endDateExclusive: '2026-11-27', timeZone: 'America/Mexico_City' },
    status: 'future',
    review: null,
    comparison: null,
  });
  assert.equal((await a.api(req('PUT', draft(), '/reviews/1'))).statusCode, 409);
  a.at('2026-11-27T05:59:59.999Z');
  assert.equal(value(await a.api(req('GET'))).weeks[0].status, 'open');
  a.at('2026-11-27T06:00:00.000Z');
  assert.equal(value(await a.api(req('GET'))).weeks[0].status, 'closed');
});
test('weekly drafts recover, replay, conflict and confirm only a finished week with explicit attestation', async () => {
  const a = await app();
  await a.enroll();
  a.at('2026-11-21T18:00:00.000Z');
  const saved = await a.api(req('PUT', draft(), '/reviews/1'));
  assert.equal(saved.statusCode, 200);
  assert.equal(value(saved).revision, 1);
  assert.deepEqual(value(await a.api(req('PUT', draft(), '/reviews/1'))), value(saved));
  assert.equal((await a.api(req('PUT', { ...draft(), summary: 'different' }, '/reviews/1'))).statusCode, 409);
  assert.equal(
    (await a.api(req('POST', { expectedRevision: 1, attested: true }, '/reviews/1/confirmation'))).statusCode,
    409,
  );
  a.at('2026-11-27T06:00:00.000Z');
  assert.equal(
    (await a.api(req('POST', { expectedRevision: 1, attested: false }, '/reviews/1/confirmation')))
      .statusCode,
    400,
  );
  const confirmed = await a.api(
    req('POST', { expectedRevision: 1, attested: true }, '/reviews/1/confirmation'),
  );
  assert.equal(confirmed.statusCode, 200);
  assert.equal(value(confirmed).status, 'confirmed');
  assert.equal((await a.api(req('PUT', { ...draft(), expectedRevision: 2 }, '/reviews/1'))).statusCode, 409);
  a.at('2027-01-01T18:00:00.000Z');
  assert.deepEqual(
    value(await a.api(req('POST', { expectedRevision: 1, attested: true }, '/reviews/1/confirmation'))),
    value(confirmed),
  );
  for (const field of ['confirmedBy', 'createdBy', 'lastFingerprint', 'classification', 'pk', 'sk'])
    assert.ok(!Object.hasOwn(value(confirmed), field));
  const w = value(await a.api(req('GET'))).weeks[0];
  assert.equal(w.comparison.history.deltaSeconds, -30);
  assert.equal(w.comparison.effortMinutes.total.delta, -15);
  const exported = await a.repository.exportRegistry();
  assert.equal(exported.reviews.length, 1);
  assert.equal(exported.reviews[0].historyLookup.medianSuccessfulSeconds, 30);
  for (const s of ['Private findings', 'Private next action', 'historyAttempts', 'confirmedBy'])
    assert.ok(!JSON.stringify(exported).includes(s));
});
test('weekly missing measurements remain null after confirmation, with no fabricated changes', async () => {
  const a = await app();
  await a.enroll();
  a.at('2026-12-18T06:00:00.000Z');
  const absent = {
    ...draft(),
    sameProtocol: null,
    historyAttempts: [],
    effortMinutes: { preparation: null, recording: null, assistance: null },
    noteAssessment: { reviewed: null, useful: null },
  };
  assert.equal((await a.api(req('PUT', absent, '/reviews/4'))).statusCode, 200);
  assert.equal(
    (await a.api(req('POST', { expectedRevision: 1, attested: true }, '/reviews/4/confirmation'))).statusCode,
    200,
  );
  const c = value(await a.api(req('GET'))).weeks[3].comparison;
  assert.equal(c.comparable, false);
  assert.equal(c.reason, 'not-attested');
  assert.equal(c.history.reviewMedianSeconds, null);
  assert.equal(c.effortMinutes.total.review, null);
  assert.equal(c.noteUsefulness.rate, null);
});
test('weekly authorization, week bounds, unknown privileges and measurement validation fail closed', async () => {
  const a = await app();
  await a.enroll();
  a.at('2026-12-18T18:00:00.000Z');
  assert.equal((await a.api(req('GET', undefined, '/reviews', 'technician'))).statusCode, 403);
  assert.equal(value(await a.api(req('GET', undefined, '/reviews', 'other'))).enrollment, null);
  assert.equal((await a.api(req('PUT', draft(), '/reviews/5'))).statusCode, 404);
  for (const bad of [
    { ...draft(), orgId: 'org-b' },
    { ...draft(), period: {} },
    { ...draft(), sameProtocol: 'yes' },
    { ...draft(), effortMinutes: { preparation: 10081, recording: 0, assistance: 0 } },
    { ...draft(), noteAssessment: { reviewed: 2, useful: 3 } },
    { ...draft(), historyAttempts: [{ success: true, seconds: -1 }] },
  ])
    assert.equal((await a.api(req('PUT', bad, '/reviews/1'))).statusCode, 400);
  a.zone('UTC');
  assert.equal((await a.api(req('PUT', draft(), '/reviews/1'))).statusCode, 409);
});
test('Dynamo map key ordering cannot turn a valid review period into a read failure', async () => {
  const a = await app();
  await a.enroll();
  a.at('2026-11-27T06:00:00.000Z');
  await a.api(req('PUT', draft(), '/reviews/1'));
  const get = a.repository.getReview.bind(a.repository);
  a.repository.getReview = async (...args) => {
    const r = await get(...args);
    if (r)
      r.period = {
        timeZone: r.period.timeZone,
        endDateExclusive: r.period.endDateExclusive,
        startDate: r.period.startDate,
      };
    return r;
  };
  const r = await a.api(req('GET'));
  assert.equal(r.statusCode, 200);
  assert.equal(value(r).weeks[0].review.period.startDate, '2026-11-20');
});

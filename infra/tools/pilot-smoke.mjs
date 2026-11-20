import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const codeFor = organization => `pilot-${createHash('sha256').update(JSON.stringify(['sedepulso-pilot-v1', organization, 'north'])).digest('hex').slice(0, 24)}`;
export async function verifyPilotEnrollment({ aws, api, expect, coordinator, technician, other, organization, exporter }) {
  const path = '/api/v1/sites/north/pilot';
  expect(await api(path), 401, 'piloto exige access token');
  expect(await api(path, { token: technician.token }), 403, 'piloto exige coordinación');
  const context = expect(await api(path, { token: coordinator.token }), 200, 'contexto autorizado del piloto');
  assert.equal(context.enrollment, null);
  assert.equal(context.classification, 'technical');
  const draft = { startDate: context.earliestStartDate, scope: { description: '', assetScope: 'all-site-assets', coordinators: null, technicians: null }, goals: { onTimeRateTarget: null, minimumDueInspections: null }, baseline: { weekStartDate: '', historyProtocol: '', historyAttempts: [], effortMinutes: { preparation: null, recording: null, assistance: null }, noteUsefulnessCriterion: '' } };
  const save = input => api(path, { token: coordinator.token, method: 'PUT', body: input });
  const incomplete = expect(await save({ expectedRevision: 0, ...draft }), 200, 'borrador incompleto conserva faltantes');
  assert.equal(incomplete.baseline.effortMinutes.preparation, null);
  const agreements = { realOperation: true, authority: true, measurement: true };
  expect(await api(`${path}/enrollment`, { token: coordinator.token, method: 'POST', body: { expectedRevision: incomplete.revision, agreements } }), 400, 'línea base incompleta no inscribe');
  const complete = { ...draft, startDate: context.latestStartDate, scope: { description: `Alcance privado de la evaluación técnica ${organization}.`, assetScope: 'all-site-assets', coordinators: 1, technicians: 1 }, goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 }, baseline: { weekStartDate: context.latestBaselineWeekStartDate, historyProtocol: `Protocolo privado de prueba ${organization}.`, historyAttempts: [{ success: true, seconds: 60 }, { success: false, seconds: 90 }], effortMinutes: { preparation: 20, recording: 10, assistance: 0 }, noteUsefulnessCriterion: `Criterio privado de prueba ${organization}.` } };
  const saved = expect(await save({ expectedRevision: incomplete.revision, ...complete }), 200, 'alcance objetivos y línea base persistidos');
  assert.deepEqual(expect(await save({ expectedRevision: incomplete.revision, ...complete }), 200, 'reintento de borrador estable'), saved);
  expect(await save({ expectedRevision: 0, ...complete }), 409, 'versión desactualizada del piloto rechazada');
  const unrelated = expect(await api(path, { token: other.token }), 200, 'otra organización no observa el piloto');
  assert.equal(unrelated.enrollment, null);
  expect(await api(`${path}/enrollment`, { token: coordinator.token, method: 'POST', body: { expectedRevision: saved.revision, agreements: { ...agreements, measurement: false } } }), 400, 'acuerdos explícitos obligatorios');
  const enrolled = expect(await api(`${path}/enrollment`, { token: coordinator.token, method: 'POST', body: { expectedRevision: saved.revision, agreements } }), 200, 'inscripción técnica confirmada');
  assert.equal(enrolled.code, codeFor(organization));
  assert.equal(enrolled.classification, 'technical');
  assert.equal(enrolled.timeZone, context.site.timeZone);
  assert.deepEqual(expect(await api(`${path}/enrollment`, { token: coordinator.token, method: 'POST', body: { expectedRevision: saved.revision, agreements } }), 200, 'reintento de inscripción conserva acuerdo'), enrolled);
  expect(await save({ expectedRevision: enrolled.revision, ...complete }), 409, 'inscripción confirmada inmutable');
  const stored = expect(await api(path, { token: coordinator.token }), 200, 'inscripción recuperada desde la sede');
  assert.deepEqual(stored.enrollment, enrolled);
  const file = join(tmpdir(), `sedepulso-pilot-export-${randomUUID()}.json`);
  try {
    const result = aws(['lambda', 'invoke', '--function-name', exporter, '--region', 'us-east-1', '--payload', JSON.stringify({ internalAction: 'exportPilotRegistry' }), '--cli-binary-format', 'raw-in-base64-out', file]);
    assert.ok(!result.FunctionError);
    const envelope = JSON.parse(await readFile(file, 'utf8'));
    expect({ status: envelope.statusCode, value: {} }, 200, 'exportador del piloto entrega agregados privados');
    const exported = JSON.parse(envelope.body);
    const cohort = exported.cohorts.find(c => c.code === enrolled.code);
    const baseline = exported.baselines.find(b => b.code === enrolled.code);
    assert.ok(cohort && baseline);
    assert.equal(cohort.classification, 'technical');
    assert.equal(baseline.historyLookup.medianSuccessfulSeconds, 60);
    assert.equal(baseline.historyLookup.failed, 1);
    assert.equal(baseline.effortMinutes.assistance, 0);
    assert.equal(baseline.period.startDate, context.latestBaselineWeekStartDate);
    assert.equal(baseline.period.timeZone, context.site.timeZone);
    for (const privateValue of [complete.scope.description, complete.baseline.historyProtocol, complete.baseline.noteUsefulnessCriterion, coordinator.sub]) assert.ok(!envelope.body.includes(privateValue));
  } finally { await rm(file, { force: true }); }
}

export function removeTechnicalPilot({ aws, tableName, organization }) {
  if (!/^smoke-a-[a-f0-9]{8}$/.test(organization || '') || !/^sedepulso-(development|testing|production)-pilot-[A-Za-z0-9-]+$/.test(tableName || '')) throw new Error('Invalid technical pilot cleanup');
  const rows = [
    { pk: { S: `ORG#${organization}#SITE#north` }, sk: { S: 'PILOT' } },
    { pk: { S: 'PILOT#REGISTRY' }, sk: { S: `COHORT#${codeFor(organization)}` } },
  ];
  for (const key of rows) {
    const readArgs = ['dynamodb', 'get-item', '--table-name', tableName, '--key', JSON.stringify(key), '--consistent-read', '--region', 'us-east-1'];
    const item = aws(readArgs).Item;
    if (!item) continue;
    const classification = item.cohort?.M?.classification?.S || item.classification?.S;
    if (classification !== undefined && classification !== 'technical') throw new Error('Refusing to remove non-technical pilot data');
    if (key.pk.S === 'PILOT#REGISTRY' && (item.cohort?.M?.orgId?.S !== organization || item.cohort?.M?.siteId?.S !== 'north')) throw new Error('Unexpected pilot registry scope');
    const registry = key.pk.S === 'PILOT#REGISTRY';
    const names = registry ? { '#c': 'cohort', '#class': 'classification', '#org': 'orgId', '#site': 'siteId' } : { '#class': 'classification' };
    const values = registry ? { ':technical': { S: 'technical' }, ':org': { S: organization }, ':site': { S: 'north' } } : { ':technical': { S: 'technical' } };
    aws(['dynamodb', 'delete-item', '--table-name', tableName, '--key', JSON.stringify(key), '--condition-expression', registry ? '#c.#class = :technical AND #c.#org = :org AND #c.#site = :site' : 'attribute_not_exists(#class) OR #class = :technical', '--expression-attribute-names', JSON.stringify(names), '--expression-attribute-values', JSON.stringify(values), '--region', 'us-east-1']);
    assert.equal(aws(readArgs).Item, undefined);
  }
}

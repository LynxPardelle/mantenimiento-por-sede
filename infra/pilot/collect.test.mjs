import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCohort } from './collect.mjs';

const cohort = { code: 'pilot-01', orgId: 'org_1', siteId: 'site_1' };
const pk = 'ORG#org_1#SITE#site_1';
const s = (value) => ({ S: value });
const page = (Items = [], extra = {}) => ({ Items, ConsumedCapacity: { CapacityUnits: 0.5 }, ...extra });
const option = (args, name) => args[args.indexOf(name) + 1];
const json = (args, name) => JSON.parse(option(args, name));
const run = (pages, extra = {}) => {
  const calls = [];
  const aws = (args) => { calls.push(args); assert.ok(pages.length, 'Unexpected query'); return pages.shift(); };
  return { calls, result: collectCohort({ aws, assetsTable: 'assets-table', inspectionsTable: 'inspections-table', cohort, ...extra }) };
};

test('collects only approved attributes, deriving structural flags without reading their values', async () => {
  const { result, calls } = run([
    page([{ sk: s('ASSET#a'), status: s('operational'), createdAt: s('2026-11-19T10:00:00.000Z') }]),
    page([{ sk: s('INSPECTION#i'), assetId: s('a'), dueDate: s('2026-11-20'), status: s('completed'), result: s('ok'), completedAt: s('2026-11-19T11:00:00.000Z') }]),
    page([{ sk: s('INSPECTION#i') }]),
    page([{ sk: s('INSPECTION#i') }]),
  ]);
  assert.deepEqual(await result, {
    code: 'pilot-01',
    assets: [{ id: 'a', status: 'operational', createdAt: '2026-11-19T10:00:00.000Z' }],
    inspections: [{ id: 'i', assetId: 'a', dueDate: '2026-11-20', status: 'completed', result: 'ok', completedAt: '2026-11-19T11:00:00.000Z', hasNote: true, hasAuthor: true }],
    readCapacityUnits: 2,
  });
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 2), ['dynamodb', 'query']);
    assert.ok(args.includes('--no-paginate'));
    assert.ok(args.includes('--consistent-read'));
    assert.equal(option(args, '--return-consumed-capacity'), 'TOTAL');
    assert.equal(option(args, '--select'), 'SPECIFIC_ATTRIBUTES');
    assert.match(option(args, '--key-condition-expression'), /begins_with/);
    const names = json(args, '--expression-attribute-names');
    const projected = option(args, '--projection-expression').split(',').map((alias) => names[alias.trim()]);
    assert.ok(!projected.some((name) => ['name', 'note', 'completedBy', 'response', 'pk'].includes(name)));
  }
  assert.equal(json(calls[0], '--expression-attribute-values')[':pk'].S, pk);
  assert.equal(json(calls[1], '--expression-attribute-values')[':pk'].S, `${pk}#ASSET#a`);
  assert.equal(json(calls[0], '--expression-attribute-values')[':prefix'].S, 'ASSET#');
  assert.equal(json(calls[1], '--expression-attribute-values')[':prefix'].S, 'INSPECTION#');
  assert.equal(json(calls[2], '--expression-attribute-names')['#presence'], 'note');
  assert.equal(json(calls[3], '--expression-attribute-names')['#presence'], 'completedBy');
  assert.match(option(calls[2], '--filter-expression'), /attribute_type.*size/);
});

test('paginates empty filtered pages and all source queries explicitly', async () => {
  const cursor = { pk: s(pk), sk: s('ASSET#a') };
  const ipk = `${pk}#ASSET#a`;
  const inspectionCursor = { pk: s(ipk), sk: s('INSPECTION#i') };
  const { result, calls } = run([
    page([], { LastEvaluatedKey: cursor }),
    page([{ sk: s('ASSET#a'), status: s('out_of_service') }]),
    page([{ sk: s('INSPECTION#i'), assetId: s('a'), dueDate: s('2026-11-20'), status: s('pending') }], { LastEvaluatedKey: inspectionCursor }),
    page([]),
    page([], { LastEvaluatedKey: inspectionCursor }),
    page([]),
    page([]),
  ]);
  const actual = await result;
  assert.equal(actual.assets.length, 1);
  assert.equal(actual.inspections.length, 1);
  assert.equal(actual.inspections[0].hasNote, false);
  assert.equal(actual.inspections[0].hasAuthor, false);
  assert.equal(actual.readCapacityUnits, 3.5);
  assert.deepEqual(json(calls[1], '--exclusive-start-key'), cursor);
  assert.deepEqual(json(calls[3], '--exclusive-start-key'), inspectionCursor);
  assert.deepEqual(json(calls[5], '--exclusive-start-key'), inspectionCursor);
});

test('does not return partial metrics after AWS failure', async () => {
  let calls = 0;
  await assert.rejects(collectCohort({ aws: () => { if (++calls === 1) return page([{ sk: s('ASSET#a'), status: s('operational') }]); throw new Error('private tenant details'); }, assetsTable: 'assets-table', inspectionsTable: 'inspections-table', cohort }), /pilot_collection_failed/);
});

test('rejects unapproved columns and idempotency rows rather than leaking values', async () => {
  for (const item of [
    { sk: s('ASSET#a'), status: s('operational'), name: s('secret') },
    { sk: s('IDEMPOTENCY#a'), status: s('operational') },
    { sk: s('ASSET#a'), status: { N: '1' } },
  ]) {
    const { result } = run([page([item])]);
    await assert.rejects(result, /pilot_collection_failed/);
  }
});

test('fails closed on repeated or cross-partition cursors and item/page limits', async () => {
  const cursor = { pk: s(pk), sk: s('ASSET#a') };
  for (const [pages, extra] of [
    [[page([], { LastEvaluatedKey: cursor }), page([], { LastEvaluatedKey: cursor })], {}],
    [[page([], { LastEvaluatedKey: { ...cursor, pk: s('ORG#other#SITE#other') } })], {}],
    [[page([], { LastEvaluatedKey: cursor })], { maxPages: 1 }],
    [[page([{ sk: s('ASSET#a'), status: s('operational') }, { sk: s('ASSET#b'), status: s('operational') }])], { maxItems: 1 }],
  ]) await assert.rejects(run(pages, extra).result, /pilot_collection_failed/);
});

test('validates scope before invoking AWS and rejects missing capacity as unknown instead of zero', async () => {
  let calls = 0;
  await assert.rejects(collectCohort({ aws: () => { calls++; }, assetsTable: 'a', inspectionsTable: 'i', cohort: { ...cohort, orgId: 'org#escape' } }), /invalid_collection_scope/);
  assert.equal(calls, 0);
  await assert.rejects(run([{ Items: [] }]).result, /pilot_collection_failed/);
});

test('rejects duplicates and inspection references outside their queried asset', async () => {
  const asset = { sk: s('ASSET#a'), status: s('operational') };
  await assert.rejects(run([page([asset, asset])]).result, /pilot_collection_failed/);
  await assert.rejects(run([page([asset]), page([{ sk: s('INSPECTION#i'), assetId: s('other'), dueDate: s('2026-11-20'), status: s('pending') }]), page([]), page([])]).result, /pilot_collection_failed/);
});

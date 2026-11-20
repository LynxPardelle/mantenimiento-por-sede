import test from 'node:test';
import assert from 'node:assert/strict';
import { removeTechnicalPilot } from '../tools/pilot-smoke.mjs';

test('cleanup refuses user organizations and tables outside the pilot service before any AWS call', () => {
  for (const args of [{ organization: 'org_real', tableName: 'sedepulso-production-pilot-PilotTable-123' }, { organization: 'smoke-a-1234abcd', tableName: 'unrelated-table' }]) {
    assert.throws(() => removeTechnicalPilot({ ...args, aws: () => assert.fail('must not call AWS') }), /Invalid technical pilot cleanup/);
  }
});

test('cleanup preserves a real enrollment and uses conditional deletion for disposable drafts', () => {
  let deleted = false;
  assert.throws(() => removeTechnicalPilot({ organization: 'smoke-a-1234abcd', tableName: 'sedepulso-production-pilot-PilotTable-123', aws: () => ({ Item: { classification: { S: 'enrolled-real' } } }) }), /non-technical/);
  removeTechnicalPilot({ organization: 'smoke-a-1234abcd', tableName: 'sedepulso-production-pilot-PilotTable-123', aws: args => {
    if (args[1] === 'delete-item') { assert.ok(args.includes('--condition-expression')); deleted = true; return {}; }
    const key = JSON.parse(args[args.indexOf('--key') + 1]);
    return key.sk.S === 'PILOT' && !deleted ? { Item: { status: { S: 'draft' } } } : {};
  } });
  assert.equal(deleted, true);
});

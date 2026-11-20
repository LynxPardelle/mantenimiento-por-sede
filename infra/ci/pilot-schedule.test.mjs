import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';

const workflow = () => parse(readFileSync(new URL('../../.github/workflows/piloto.yml', import.meta.url), 'utf8'));

test('pilot retains its daily morning schedule and adds an off-hour daily recovery observation', () => {
  const w = workflow();
  assert.deepEqual(w.on.schedule, [{cron:'17 13 * * *'}, {cron:'57 21 * * *'}]);
  assert.equal(w.jobs.observe.environment, "${{ github.event_name == 'schedule' && 'production' || inputs.environment }}");
  assert.equal(w.jobs.observe.concurrency['cancel-in-progress'], false);
  assert.deepEqual(w.jobs.observe.permissions, {contents:'read','id-token':'write'});
  const credentials = w.jobs.observe.steps.find(s => s.uses === 'aws-actions/configure-aws-credentials@v4');
  assert.equal(credentials.with['role-to-assume'], '${{ vars.PILOT_OBSERVER_ROLE_ARN }}');
  assert.ok(!JSON.stringify(w).includes('AWS_DEPLOY_ROLE_ARN'));
});

test('both real schedules and manual dispatch keep the main and matching-environment guards', () => {
  const w = workflow();
  const allowed = new Function('github', 'inputs', `return (${w.jobs.observe.if});`);
  for (const cron of ['17 13 * * *','57 21 * * *']) {
    assert.equal(allowed({event_name:'schedule',ref_name:'main',event:{schedule:cron}}, {}), true);
    for(const branch of ['development','testing','feature/untrusted']) assert.equal(allowed({event_name:'schedule',ref_name:branch,event:{schedule:cron}}, {}), false);
  }
  for(const [branch,env] of [['development','development'],['testing','testing'],['main','production']]) assert.equal(allowed({event_name:'workflow_dispatch',ref_name:branch},{environment:env}),true);
  for(const [branch,env] of [['development','production'],['main','testing'],['testing','development'],['feature/untrusted','production']]) assert.equal(allowed({event_name:'workflow_dispatch',ref_name:branch},{environment:env}),false);
  assert.equal(allowed({event_name:'push',ref_name:'main'}, {environment:'production'}), false);
});

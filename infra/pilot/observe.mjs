import { aggregatePilotTotals, summarizePilot, validateRegistry } from './metrics.mjs';

export async function observePilot({ aws, describeStack, readJson, putJson, fetchJson, collect, environment,
  checkedAt = new Date().toISOString(), runId = 'local', sourceCommit = null }) {
  if (!['development', 'testing', 'production'].includes(environment) || !/^[a-zA-Z0-9-]{1,100}$/.test(runId)) throw new Error('invalid_observation_scope');
  let registry;
  try { registry = validateRegistry(await readJson(`${environment}/registry.json`)); }
  catch { throw new Error('pilot_registry_unavailable_or_invalid'); }
  if (environment !== 'production' && registry.cohorts.some(c => c.classification !== 'technical')) throw new Error('real_cohort_requires_production');
  const stacks = {};
  for (const name of ['platform', 'assets', 'inspections', 'frontend']) {
    stacks[name] = await describeStack(`sedepulso-${environment}-${name}`);
    if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stacks[name].status)) throw new Error('pilot_stack_not_ready');
  }
  const url = `https://sedepulso${environment === 'production' ? '' : '-' + environment}.lynxpardelle.com`;
  const [config, health] = await Promise.all([fetchJson(`${url}/api/config`), fetchJson(`${url}/api/health`)]);
  if (config.billingEnabled !== false) throw new Error('pilot_billing_guard_failed');
  if (config.signupEnabled !== true || health.status !== 'ok') throw new Error('pilot_public_health_failed');
  const tables = { access: stacks.platform.outputs.AccessTableName, assets: stacks.assets.outputs.AssetsTableName, inspections: stacks.inspections.outputs.InspectionsTableName };
  const tableMetadata = {};
  for (const [domain, table] of Object.entries(tables)) {
    if (!table) throw new Error('pilot_table_output_missing');
    const { Table } = aws(['dynamodb', 'describe-table', '--table-name', table, '--region', 'us-east-1']);
    if (Table?.TableStatus !== 'ACTIVE' || !Number.isInteger(Table.ItemCount) || Table.ItemCount < 0) throw new Error('pilot_table_not_ready');
    tableMetadata[domain] = { approximateItems: Table.ItemCount, caveat: 'DynamoDB metadata updated approximately every six hours; includes unclassified and technical records, not participants or active users.' };
  }
  const alarmNames = Object.values(stacks).flatMap(stack => stack.alarmNames || []);
  if (!alarmNames.length || alarmNames.length > 100 || new Set(alarmNames).size !== alarmNames.length || alarmNames.some(name => typeof name !== 'string' || !name.startsWith(`sedepulso-${environment}-`))) throw new Error('pilot_alarms_incomplete');
  const alarms = aws(['cloudwatch', 'describe-alarms', '--alarm-names', ...alarmNames, '--region', 'us-east-1']);
  if (alarms.NextToken || !Array.isArray(alarms.MetricAlarms) || alarms.MetricAlarms.length !== alarmNames.length || new Set(alarms.MetricAlarms.map(a => a.AlarmName)).size !== alarmNames.length || alarms.MetricAlarms.some(a => !alarmNames.includes(a.AlarmName))) throw new Error('pilot_alarms_incomplete');
  const alarmStates = { OK: 0, ALARM: 0, INSUFFICIENT_DATA: 0 };
  for (const alarm of alarms.MetricAlarms) {
    if (!(alarm.StateValue in alarmStates)) throw new Error('pilot_alarm_state_invalid');
    alarmStates[alarm.StateValue]++;
  }
  const observations = [];
  for (const cohort of registry.cohorts) observations.push(await collect({ aws, assetsTable: tables.assets, inspectionsTable: tables.inspections, cohort }));
  const report = {
    ...summarizePilot({ cohorts: registry.cohorts, observations: observations.map(({ code, assets, inspections }) => ({ code, assets, inspections })), checkedAt }),
    environment, sourceCommit, runId,
    observationWindow: { startedAt: checkedAt, completedAt: new Date().toISOString(), crossTableAtomicSnapshot: false },
    safety: { billingEnabled: false, signupEnabled: true, businessWrites: false },
    operations: { url, stackStatus: Object.fromEntries(Object.entries(stacks).map(([key, value]) => [key, value.status])), tableMetadata, alarmStates,
      alarmNotificationsConfigured: alarms.MetricAlarms.every(a => a.ActionsEnabled !== false && a.AlarmActions?.length > 0),
      collectorReadCapacityUnits: observations.reduce((n, o) => n + o.readCapacityUnits, 0),
      awsProductCost: { value: null, status: 'not-measured' },
    },
    weeklySnapshots: [],
  };
  // Write once: a later run cannot revise a closed week's first observed evidence.
  for (const cohort of report.cohorts) for (const week of cohort.weeks) if (week.status === 'closed') {
    const key = `${environment}/reports/weekly/${cohort.code}/${cohort.startDate}/week-${week.week}.json`;
    const created = await putJson(key, { schemaVersion: 1, code: cohort.code, classification: cohort.classification, timeZone: cohort.timeZone, startDate: cohort.startDate, firstObservedAt: checkedAt, sourceCommit, week, caveat: 'First observation after the boundary; timestamps reconstruct eligible state where available. Missing legacy timestamps and concurrent reads limit historical completeness. No automatic overwrite.' }, { ifAbsent: true });
    if (!created) {
      const frozen = await readJson(key);
      if (frozen.schemaVersion !== 1 || frozen.code !== cohort.code || frozen.startDate !== cohort.startDate || frozen.classification !== cohort.classification || frozen.timeZone !== cohort.timeZone || frozen.week?.week !== week.week || frozen.week?.status !== 'closed' || frozen.week?.startUtc !== week.startUtc || frozen.week?.endUtc !== week.endUtc) throw new Error('pilot_frozen_week_invalid');
      cohort.weeks[week.week - 1] = frozen.week;
    }
    report.weeklySnapshots.push({ code: cohort.code, week: week.week, key, created });
  }
  report.totals = aggregatePilotTotals(report.cohorts);
  const date = checkedAt.slice(0, 10);
  await putJson(`${environment}/reports/daily/${date}/${checkedAt.replace(/[:.]/g, '-')}-${runId}.json`, report, { ifAbsent: true });
  await putJson(`${environment}/reports/latest.json`, report);
  if (alarmStates.ALARM || alarmStates.INSUFFICIENT_DATA) throw new Error('pilot_alarm_attention_report_saved');
  return report;
}

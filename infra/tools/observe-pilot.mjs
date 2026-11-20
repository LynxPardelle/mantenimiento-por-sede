import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aws } from './aws.mjs';
import { collectCohort } from '../pilot/collect.mjs';
import { observePilot } from '../pilot/observe.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const environment = option('--environment', 'production');
const bucket = process.env.PILOT_REPORT_BUCKET;
const runId = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}` : `local-${Date.now()}`;
const out = fileURLToPath(new URL(`../.artifacts/pilot-${runId}/`, import.meta.url));
let phase = 'configuration';
let createdDirectory = false;
try {
  if (!/^sedepulso-pilot-\d{12}-us-east-1$/.test(bucket || '')) throw new Error('invalid_private_bucket');
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(runId)) throw new Error('invalid_run_identifier');
  await mkdir(out, { recursive: true });
  createdDirectory = true;
  const readJson = async key => {
    const file = join(out, 'input.json');
    aws(['s3api', 'get-object', '--bucket', bucket, '--key', key, '--region', 'us-east-1', file]);
    const value = JSON.parse(await readFile(file, 'utf8'));
    await rm(file, { force: true });
    return value;
  };
  const putJson = async (key, value, { ifAbsent = false } = {}) => {
    const file = join(out, 'output.json');
    await writeFile(file, JSON.stringify(value, null, 2) + '\n');
    try {
      aws(['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', file, '--server-side-encryption', 'AES256', '--content-type', 'application/json', '--region', 'us-east-1', ...(ifAbsent ? ['--if-none-match', '*'] : [])]);
      return true;
    } catch (error) { if (ifAbsent && /\(PreconditionFailed\)/.test(error.message)) return false; throw error; }
    finally { await rm(file, { force: true }); }
  };
  const describeStack = name => {
    const stack = aws(['cloudformation', 'describe-stacks', '--stack-name', name, '--region', 'us-east-1']).Stacks[0];
    const resources = aws(['cloudformation', 'list-stack-resources', '--stack-name', name, '--region', 'us-east-1']).StackResourceSummaries;
    return { status: stack.StackStatus, outputs: Object.fromEntries((stack.Outputs || []).map(o => [o.OutputKey, o.OutputValue])), alarmNames: resources.filter(r => r.ResourceType === 'AWS::CloudWatch::Alarm').map(r => r.PhysicalResourceId) };
  };
  const fetchJson = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (response.status !== 200) throw new Error('https_failed');
    return response.json();
  };
  const getEnrollments = async functionName => {
    if (typeof functionName !== 'string' || !functionName.startsWith(`sedepulso-${environment}-pilot-PilotExportFunction-`)) throw new Error('pilot_enrollment_export_unavailable');
    const file = join(out, 'enrollments.json');
    try {
      const metadata = aws(['lambda', 'invoke', '--function-name', functionName, '--region', 'us-east-1', '--payload', JSON.stringify({ internalAction: 'exportPilotRegistry' }), '--cli-binary-format', 'raw-in-base64-out', file]);
      if (metadata.FunctionError) throw new Error('pilot_enrollment_export_failed');
      const result = JSON.parse(await readFile(file, 'utf8'));
      if (result.statusCode !== 200) throw new Error('pilot_enrollment_export_failed');
      return JSON.parse(result.body);
    } finally { await rm(file, { force: true }); }
  };
  phase = 'observation';
  const report = await observePilot({ aws, describeStack, readJson, putJson, fetchJson, getEnrollments, collect: collectCohort, environment, runId, sourceCommit: process.env.GITHUB_SHA || null });
  // Public repository: neither tenant metrics nor the registry belong in logs/artifacts.
  console.log(JSON.stringify({ environment, observer: 'passed', billingEnabled: false, privateReportSaved: true }));
} catch (error) {
  const known = /^(?:pilot_[a-z_]+|invalid_(?:collection_scope|observation_scope|run_identifier|private_bucket|registry|observations|cutoff|reports)|real_cohort_requires_production)$/;
  const code = known.test(error.message || '') ? error.message : 'unclassified_failure';
  console.error(`pilot_${phase}_failed: ${code}; inspect authorized local diagnostics`);
  process.exitCode = 1;
} finally {
  if (createdDirectory) {
    await rm(join(out, 'input.json'), { force: true });
    await rm(join(out, 'output.json'), { force: true });
    await rmdir(out);
  }
}

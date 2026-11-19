import { execFileSync } from 'node:child_process';

export function aws(args, { json = true, input, quiet = true } = {}) {
  let result;
  try { result = execFileSync('aws', [...args, '--no-cli-pager', '--cli-connect-timeout', '15', '--cli-read-timeout', '60', ...(json ? ['--output', 'json'] : [])], {
    encoding: 'utf8', input, maxBuffer: 10 * 1024 * 1024,
    stdio: ['pipe', 'pipe', quiet ? 'pipe' : 'inherit'],
    env: { ...process.env, AWS_PAGER: '', PYTHONIOENCODING: 'utf-8' },
  }); } catch (error) {
    // Do not include argv: administrative auth calls can contain ephemeral passwords.
    throw new Error(`AWS ${args.slice(0, 2).join(' ')}: ${String(error.stderr || 'falló la operación').trim()}`);
  }
  return json ? (result.trim() ? JSON.parse(result) : {}) : result;
}

export function stackOutputs(stackName, region = 'us-east-1') {
  const result = aws(['cloudformation', 'describe-stacks', '--stack-name', stackName, '--region', region]);
  return Object.fromEntries((result.Stacks[0].Outputs || []).map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]));
}

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCiTemplate } from '../ci/template.mjs';
import { discoverUserPools } from '../ci/pools.mjs';
import { ensureArtifactBucket } from '../ci/artifacts.mjs';
import { aws, stackOutputs } from './aws.mjs';

const region = 'us-east-1';
const repository = 'LynxPardelle/mantenimiento-por-sede';
const infra = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(infra, '.artifacts');
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 1024 * 1024 });
const oidcSubject = JSON.parse(gh(['api', `repos/${repository}/actions/oidc/customization/sub`]));
if (!oidcSubject.use_default) throw new Error('El repositorio usa un subject OIDC personalizado; se conservó sin modificar.');
const subjectPrefix = oidcSubject.sub_claim_prefix || `repo:${repository}`;
const account = aws(['sts', 'get-caller-identity']).Account;
const providerArn = `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`;
const providers = aws(['iam', 'list-open-id-connect-providers']).OpenIDConnectProviderList;
const providerExists = providers.some(({ Arn }) => Arn === providerArn);
if (!providerExists && !process.argv.includes('--template-only')) {
  aws(['iam', 'create-open-id-connect-provider', '--url', 'https://token.actions.githubusercontent.com', '--client-id-list', 'sts.amazonaws.com']);
}
if (providerExists) {
  const provider = aws(['iam', 'get-open-id-connect-provider', '--open-id-connect-provider-arn', providerArn]);
  if (!provider.ClientIDList.includes('sts.amazonaws.com')) throw new Error('El proveedor compartido no admite STS; no se modificó su configuración.');
}
const zone = aws(['route53', 'list-hosted-zones-by-name', '--dns-name', 'lynxpardelle.com', '--max-items', '2']).HostedZones.find(({ Name, Config }) => Name === 'lynxpardelle.com.' && !Config.PrivateZone);
if (!zone) throw new Error('No existe la zona pública lynxpardelle.com.');
const userPoolArns = discoverUserPools(aws, { account, region });
const template = buildCiTemplate({ account, providerArn, hostedZoneId: zone.Id.split('/').at(-1), subjectPrefix, region, userPoolArns });
await mkdir(out, { recursive: true });
const templatePath = join(out, 'ci-template.json');
await writeFile(templatePath, JSON.stringify(template, null, 2) + '\n');
if (process.argv.includes('--template-only')) {
  console.log(JSON.stringify({ templatePath, account, providerArn }));
  process.exit(0);
}
const { bucket } = ensureArtifactBucket(aws, { account, region });
aws(['cloudformation', 'deploy', '--region', region, '--stack-name', 'sedepulso-ci-oidc', '--template-file', templatePath, '--s3-bucket', bucket, '--s3-prefix', 'bootstrap/ci', '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-fail-on-empty-changeset', '--tags', 'Product=sedepulso', 'Purpose=github-oidc'], { json: false, quiet: false });
const outputs = stackOutputs('sedepulso-ci-oidc', region);
const existing = JSON.parse(gh(['api', `repos/${repository}/environments`])).environments;
const summary = [];
for (const [environment, branch] of [['development', 'development'], ['testing', 'testing'], ['production', 'main']]) {
  if (!existing.some(({ name }) => name === environment)) {
    gh(['api', '--method', 'PUT', `repos/${repository}/environments/${environment}`, '--input', '-'], JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }));
    gh(['api', '--method', 'POST', `repos/${repository}/environments/${environment}/deployment-branch-policies`, '--input', '-'], JSON.stringify({ name: branch, type: 'branch' }));
  } else {
    const environmentState = existing.find(({ name }) => name === environment);
    if (environmentState.deployment_branch_policy?.custom_branch_policies) {
      const rules = JSON.parse(gh(['api', `repos/${repository}/environments/${environment}/deployment-branch-policies`])).branch_policies;
      if (!rules.some(({ name, type }) => name === branch && type === 'branch')) throw new Error(`El ambiente ${environment} no permite ${branch}; las protecciones existentes se conservaron.`);
    } else if (!environmentState.deployment_branch_policy?.protected_branches) {
      throw new Error(`El ambiente ${environment} no tiene restricción de ramas; se requiere configurarla antes de habilitar OIDC.`);
    }
  }
  const id = environment[0].toUpperCase() + environment.slice(1);
  const deployRole = outputs[id + 'DeployRoleArn'];
  const cloudFormationRole = outputs[id + 'CloudFormationRoleArn'];
  gh(['variable', 'set', 'AWS_DEPLOY_ROLE_ARN', '--repo', repository, '--env', environment, '--body', deployRole]);
  gh(['variable', 'set', 'CLOUDFORMATION_ROLE_ARN', '--repo', repository, '--env', environment, '--body', cloudFormationRole]);
  gh(['variable', 'set', 'SIGNUP_WEB_ACL_ARN', '--repo', repository, '--env', environment, '--body', outputs.SignupWebAclArn]);
  gh(['variable', 'set', 'COGNITO_WAF_POOL_READY', '--repo', repository, '--env', environment, '--body', String(Boolean(userPoolArns[environment]))]);
  gh(['variable', 'set', 'PILOT_OBSERVER_ROLE_ARN', '--repo', repository, '--env', environment, '--body', outputs[id + 'PilotRoleArn']]);
  gh(['variable', 'set', 'PILOT_REPORT_BUCKET', '--repo', repository, '--env', environment, '--body', outputs.PilotBucketName]);
  summary.push({ environment, branch, deployRole, cloudFormationRole, runtimeBoundary: outputs[id + 'RuntimeBoundaryArn'], wafUserPoolArn: userPoolArns[environment] || null });
}
await writeFile(join(out, 'ci-oidc.json'), JSON.stringify({ repository, subjectPrefix, region, providerArn, signupWebAclArn: outputs.SignupWebAclArn, stack: 'sedepulso-ci-oidc', environments: summary }, null, 2) + '\n');
console.log(JSON.stringify({ repository, subjectPrefix, providerArn, signupWebAclArn: outputs.SignupWebAclArn, stack: 'sedepulso-ci-oidc', environments: summary }, null, 2));

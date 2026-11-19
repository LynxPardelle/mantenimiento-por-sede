import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { aws, stackOutputs } from './aws.mjs';

const infra = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const environment = args[args.indexOf('--environment') + 1];
if (!['development', 'testing', 'production'].includes(environment)) throw new Error('Especifica --environment development|testing|production.');
const service = args.includes('--service') ? args[args.indexOf('--service') + 1] : 'all';
if (!['all', 'platform', 'assets', 'inspections', 'frontend'].includes(service)) throw new Error('--service debe ser platform|assets|inspections|frontend|all.');
const region = 'us-east-1'; // ACM para CloudFront vive en esta región.
const expected = { development: 'development', testing: 'testing', production: 'main' }[environment];
const branch = execFileSync('git', ['branch', '--show-current'], { cwd: infra, encoding: 'utf8' }).trim();
if (environment !== 'development' && branch !== expected) throw new Error(`El ambiente ${environment} sólo se publica desde ${expected}.`);
if (environment !== 'development' && execFileSync('git', ['status', '--porcelain'], { cwd: infra, encoding: 'utf8' }).trim()) throw new Error('Promueve un commit limpio antes de publicar testing o producción.');
if (environment !== 'development' && process.env.CI !== 'true') throw new Error('Testing y producción se publican mediante el flujo CI de promoción.');
const manifest = JSON.parse(await readFile(join(infra, '.artifacts', 'manifest.json'), 'utf8'));
if ((service === 'frontend' || service === 'all') && !manifest.packages?.includes('frontend')) throw new Error('Empaqueta el frontend antes de publicar este servicio.');
if (environment !== 'development') {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: infra, encoding: 'utf8' }).trim();
  if (manifest.sourceCommit !== commit || manifest.sourceBranch !== branch || manifest.dirty) throw new Error('El artefacto debe corresponder al commit limpio de la rama promovida.');
}
// Uploaded packages and templates must still be the bytes recorded at packaging time.
for (let offset = 0; offset < manifest.files.length; offset += 32) {
await Promise.all(manifest.files.slice(offset, offset + 32).map(async (file) => {
  const staged = /^(domain|frontend|health|config)\//.test(file.path);
  const root = staged ? join(infra, '.artifacts') : infra;
  const path = resolve(root, file.path);
  if (!path.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Ruta de manifiesto fuera del paquete.');
  const actual = createHash('sha256').update(await readFile(path)).digest('hex');
  if (actual !== file.sha256) throw new Error(`El artefacto cambió desde el empaquetado: ${file.path}. Empaqueta de nuevo.`);
}));
}
const account = aws(['sts', 'get-caller-identity']).Account;
const bucket = `sedepulso-artifacts-${account}-${region}`;
const host = `sedepulso${environment === 'production' ? '' : '-' + environment}.lynxpardelle.com`;
const zones = aws(['route53', 'list-hosted-zones-by-name', '--dns-name', 'lynxpardelle.com', '--max-items', '2']).HostedZones;
const zone = zones.find((item) => item.Name === 'lynxpardelle.com.' && !item.Config.PrivateZone);
if (!zone) throw new Error('No se encontró la zona pública lynxpardelle.com.');
try { aws(['s3api', 'head-bucket', '--bucket', bucket]); }
catch {
  aws(['s3api', 'create-bucket', '--bucket', bucket, '--region', region]);
  aws(['s3api', 'put-public-access-block', '--bucket', bucket, '--public-access-block-configuration', JSON.stringify({ BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true })]);
  aws(['s3api', 'put-bucket-versioning', '--bucket', bucket, '--versioning-configuration', 'Status=Enabled']);
}
const prefix = `sedepulso-${environment}`;
const reports = {};
async function deploy(service, template, parameters) {
  const name = `${prefix}-${service}`;
  const packaged = join(infra, '.artifacts', `${service}.packaged.yaml`);
  console.log(`Empaquetando ${name}...`);
  aws(['cloudformation', 'package', '--region', region, '--template-file', join(infra, template), '--s3-bucket', bucket, '--s3-prefix', `${environment}/${manifest.release}/${service}`, '--output-template-file', packaged], { json: false });
  aws(['cloudformation', 'validate-template', '--region', region, '--template-body', `file://${packaged}`]);
  // Preserve the exact service template and manifest alongside immutable code for a later rollback.
  aws(['s3', 'cp', packaged, `s3://${bucket}/${environment}/${manifest.release}/${service}/template.yaml`, '--only-show-errors'], { json: false });
  aws(['s3', 'cp', join(infra, '.artifacts', 'manifest.json'), `s3://${bucket}/${environment}/${manifest.release}/manifest.json`, '--only-show-errors'], { json: false });
  console.log(`Publicando ${name}...`);
  aws(['cloudformation', 'deploy', '--region', region, '--stack-name', name, '--template-file', packaged, '--capabilities', 'CAPABILITY_IAM', 'CAPABILITY_AUTO_EXPAND', '--no-fail-on-empty-changeset', '--tags', 'Product=sedepulso', `Environment=${environment}`, '--parameter-overrides', ...Object.entries(parameters).map(([key, value]) => `${key}=${value}`)], { json: false, quiet: false });
  reports[service] = stackOutputs(name, region);
  return reports[service];
}
async function selected(name, template, parameters) {
  if (service === 'all' || service === name) return deploy(name, template, parameters);
  reports[name] = stackOutputs(`${prefix}-${name}`, region);
  return reports[name];
}
const platform = await selected('platform', 'template.yaml', { Environment: environment, AppHost: host });
const shared = { Environment: environment, ApiId: platform.ApiId, AuthorizerId: platform.AuthorizerId, AccessFunctionName: platform.AccessFunctionName, AccessFunctionArn: platform.AccessFunctionArn };
if (['all', 'assets', 'inspections'].includes(service)) {
const assets = await selected('assets', 'services/assets.yaml', shared);
if (service !== 'assets') await selected('inspections', 'services/inspections.yaml', { ...shared, AssetsFunctionName: assets.AssetsFunctionName, AssetsFunctionArn: assets.AssetsFunctionArn });
}
if (service === 'all' || service === 'frontend') {
const publishStatic = (bucketName) => aws(['s3', 'sync', join(infra, '.artifacts', 'browser'), `s3://${bucketName}/`, '--cache-control', 'public,max-age=31536000,immutable', '--exclude', '*.html', '--exclude', '*.map', '--only-show-errors'], { json: false });
// Publish new hashed assets before switching a live SSR version. Old hashes stay for rollback.
let previousFrontend;
try { previousFrontend = stackOutputs(`${prefix}-frontend`, region); }
catch (error) { if (!error.message.includes('does not exist')) throw error; }
if (previousFrontend) publishStatic(previousFrontend.StaticBucketName);
const frontend = await deploy('frontend', 'frontend.yaml', { Environment: environment, AppHost: host, HostedZoneId: zone.Id.split('/').at(-1), ApiOrigin: platform.ApiOrigin });
console.log('Publicando estáticos con nombres versionados...');
if (!previousFrontend || previousFrontend.StaticBucketName !== frontend.StaticBucketName) publishStatic(frontend.StaticBucketName);
aws(['cloudfront', 'create-invalidation', '--distribution-id', frontend.DistributionId, '--paths', '/']);
}
await writeFile(join(infra, '.artifacts', `${environment}.json`), JSON.stringify({ product: 'SedePulso', environment, host, release: manifest.release, stacks: reports }, null, 2) + '\n');
console.log(JSON.stringify({ product: 'SedePulso', environment, service, ...(reports.frontend ? { url: `https://${host}` } : {}), release: manifest.release }));

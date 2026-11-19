import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const infra = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(infra, '..');
const out = join(infra, '.artifacts');
const built = join(repo, 'frontend', 'dist', 'sedepulso');
const backendOnly = process.argv.includes('--backend-only');
if (!backendOnly) await stat(join(built, 'server', 'server.mjs'));
await stat(join(infra, 'functions', 'domain', 'dynamodb.mjs'));
await stat(join(infra, 'functions', 'domain', 'invoke.mjs'));
await mkdir(out, { recursive: true });
for (const name of backendOnly ? ['domain', 'health', 'config'] : ['domain', 'health', 'config', 'frontend', 'browser']) {
  const target = resolve(out, name);
  if (dirname(target) !== out) throw new Error('Destino de empaquetado fuera de .artifacts.');
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}
await cp(join(infra, 'functions', 'domain'), join(out, 'domain'), { recursive: true });
await cp(join(infra, 'node_modules'), join(out, 'domain', 'node_modules'), { recursive: true });
await writeFile(join(out, 'domain', 'package.json'), '{"type":"module"}\n');
for (const name of ['health', 'config']) await cp(join(infra, 'functions', name), join(out, name), { recursive: true });
if (!backendOnly) {
await cp(join(built, 'server'), join(out, 'frontend', 'server'), { recursive: true });
await cp(join(built, 'browser'), join(out, 'frontend', 'browser'), { recursive: true });
await cp(join(built, 'browser'), join(out, 'browser'), { recursive: true });
await cp(join(repo, 'frontend', 'node_modules', 'serverless-http'), join(out, 'frontend', 'node_modules', 'serverless-http'), { recursive: true });
await cp(join(infra, 'tools', 'ssr-handler.mjs'), join(out, 'frontend', 'ssr-handler.mjs'));
await writeFile(join(out, 'frontend', 'index.mjs'), `import {reqHandler} from './server/server.mjs';\nimport {createSsrHandler} from './ssr-handler.mjs';\nexport const handler=createSsrHandler(reqHandler,process.env.APP_HOST);\n`);
await writeFile(join(out, 'frontend', 'package.json'), '{"type":"module"}\n');
}
const files = [];
async function hashDirectory(root, relative = '', prefix = '') {
  for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = join(relative, entry.name);
    if (entry.isDirectory()) await hashDirectory(root, name, prefix);
    else files.push({ path: join(prefix, name).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(join(root, name))).digest('hex') });
  }
}
if (!backendOnly) await hashDirectory(join(out, 'frontend'), '', 'frontend');
await hashDirectory(join(out, 'domain'), '', 'domain');
for (const name of ['health', 'config']) await hashDirectory(join(out, name), '', name);
for (const template of ['template.yaml', 'services/assets.yaml', 'services/inspections.yaml', 'frontend.yaml']) {
  files.push({ path: template, sha256: createHash('sha256').update(await readFile(join(infra, template))).digest('hex') });
}
const release = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
await writeFile(join(out, 'manifest.json'), JSON.stringify({ product: 'sedepulso', release, packages: backendOnly ? ['domain'] : ['domain', 'frontend'], runtime: 'nodejs24.x', sourceCommit: git(['rev-parse', 'HEAD']), sourceBranch: git(['branch', '--show-current']), dirty: !!git(['status', '--porcelain']), files }, null, 2) + '\n');
console.log(JSON.stringify({ product: 'SedePulso', release, output: out }));

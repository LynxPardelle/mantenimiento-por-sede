import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { aws, stackOutputs } from './aws.mjs';

const region = 'us-east-1';
const missing = (error) => /ResourceNotFoundException|BackupNotFoundException/.test(error.message);
const arnFor = (account, table) => `arn:aws:dynamodb:${region}:${account}:table/${table}`;
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function validateRecoveryTargets(input) {
  if (input.environment !== 'development') throw new Error('La prueba de recuperación sólo admite development.');
  if (!/^[a-f0-9]{12}$/.test(input.nonce || '')) throw new Error('Nonce de recuperación no válido.');
  if (!/^\d{12}$/.test(input.account || '')) throw new Error('Cuenta AWS no válida.');
  if (!/^sedepulso-development-platform-AccessTable-[A-Za-z0-9]+$/.test(input.sourceTable || '')) throw new Error('Tabla de origen fuera del stack development autorizado.');
  const targetTable = `sedepulso-development-recovery-${input.nonce}`;
  if ((input.targetTable !== undefined && input.targetTable !== targetTable) || input.sourceTable === targetTable) throw new Error('El destino temporal debe coincidir exactamente con el nonce y diferir del origen.');
  const sourceArn = arnFor(input.account, input.sourceTable);
  const targetArn = arnFor(input.account, targetTable);
  if ((input.sourceArn !== undefined && input.sourceArn !== sourceArn) || (input.targetArn !== undefined && input.targetArn !== targetArn)) throw new Error('ARN de origen o destino no coincide con cuenta y tabla.');
  if (input.backupArn && !new RegExp(`^${escaped(sourceArn)}/backup/[A-Za-z0-9-]+$`).test(input.backupArn)) throw new Error('ARN del backup fuera del origen y cuenta autorizados.');
  return { environment: 'development', region, nonce: input.nonce, account: input.account, sourceTable: input.sourceTable, sourceArn, targetTable, targetArn, backupName: targetTable, ...(input.backupArn ? { backupArn: input.backupArn } : {}), ...(input.restoreProof ? { restoreProof: input.restoreProof } : {}) };
}

export function verifyBackup(input, description) {
  const context = validateRecoveryTargets(input);
  const details = description?.BackupDetails;
  if (!context.backupArn || details?.BackupArn !== context.backupArn || details?.BackupName !== context.backupName || details?.BackupType !== 'USER') throw new Error('El backup no coincide exactamente con el creado por esta ejecución.');
  if (description.SourceTableDetails?.TableArn !== context.sourceArn || description.SourceTableDetails?.TableName !== context.sourceTable) throw new Error('El origen del backup no coincide con la tabla development autorizada.');
  return description;
}

export function verifyRestoredTable(input, table) {
  const context = validateRecoveryTargets(input);
  if (table?.TableName !== context.targetTable || table?.TableArn !== context.targetArn) throw new Error('El destino temporal no coincide con su ARN y cuenta autorizados.');
  const summary = table.RestoreSummary;
  if (!context.backupArn || (summary?.SourceBackupArn && summary.SourceBackupArn !== context.backupArn) || (summary?.SourceTableArn && summary.SourceTableArn !== context.sourceArn)) throw new Error('La tabla temporal no procede del backup de esta ejecución; no se modificará.');
  const proof = context.restoreProof;
  const boundTableId = proof?.tableName === context.targetTable && proof?.tableArn === context.targetArn && proof?.sourceBackupArn === context.backupArn && typeof proof?.tableId === 'string' && /^[a-f0-9-]{36}$/i.test(proof.tableId) && table.TableId === proof.tableId;
  if (proof && !boundTableId) throw new Error('La tabla no conserva el TableId inmutable de la restauración propia; no se modificará.');
  if (summary?.SourceBackupArn !== context.backupArn && !boundTableId) throw new Error('Falta prueba de restauración ligada al backup y al TableId inmutable; no se modificará.');
  return table;
}

export async function executeRecovery({ environment, sourceTable, account, nonce = randomBytes(6).toString('hex'), invoke = aws, sleep = delay, progress = console.log, save = async () => {}, waitLimitMs = 45 * 60 * 1000 }) {
  let context = validateRecoveryTargets({ environment, sourceTable, account, nonce });
  const key = { pk: { S: `RECOVERY#${nonce}` }, sk: { S: 'CHECK' } };
  const probe = randomBytes(24).toString('hex');
  const item = { ...key, probe: { S: probe } };
  const started = Date.now();
  const report = { product: 'SedePulso', environment: 'development', region, account, startedAt: new Date(started).toISOString(), sourceTable, temporaryTable: context.targetTable, backupName: context.backupName, markerKey: { pk: key.pk.S, sk: key.sk.S }, markerDigest: createHash('sha256').update(probe).digest('hex'), markerVerified: false, cleanup: { temporaryTableDeleted: false, backupDeleted: false, sourceMarkerDeleted: false }, billableOperations: { onDemandBackupsCreated: 0, tableRestoresRequested: 0 }, status: 'running' };
  const call = (operation, ...args) => invoke(['dynamodb', operation, '--region', region, ...args]);
  async function checkpoint(stage) { report.stage = stage; await save(report); progress(`Recuperación development: ${stage}`); }
  const getTable = (table) => {
    try { return call('describe-table', '--table-name', table).Table; }
    catch (error) { if (missing(error)) return undefined; throw error; }
  };
  async function waitFor(label, read, ready, limit = waitLimitMs) {
    const begin = Date.now();
    for (;;) {
      const value = read();
      if (ready(value)) return value;
      if (Date.now() - begin > limit) throw new Error(`Se agotó la espera de ${label}.`);
      progress(`Esperando ${label}; transcurridos ${Math.floor((Date.now() - begin) / 1000)} s.`);
      await sleep(15000);
    }
  }
  let markerAttempted = false, restoreAttempted = false, failure;
  await checkpoint('preflight');
  try {
    const identity = invoke(['sts', 'get-caller-identity']);
    if (identity.Account !== account) throw new Error('La cuenta activa cambió; no se escribirán datos.');
    const source = getTable(sourceTable);
    if (source?.TableArn !== context.sourceArn || source?.TableStatus !== 'ACTIVE') throw new Error('La tabla de origen no está activa o su ARN no coincide.');
    if (getTable(context.targetTable)) throw new Error('El destino temporal ya existe; no se reutiliza ni se elimina.');
    markerAttempted = true;
    call('put-item', '--table-name', sourceTable, '--item', JSON.stringify(item), '--condition-expression', 'attribute_not_exists(pk)');
    await checkpoint('marcador propio escrito');
    const created = call('create-backup', '--table-name', sourceTable, '--backup-name', context.backupName).BackupDetails;
    context = validateRecoveryTargets({ ...context, backupArn: created?.BackupArn });
    if (!context.backupArn || created.BackupName !== context.backupName) throw new Error('CreateBackup no devolvió el backup esperado.');
    report.backupArn = context.backupArn;
    report.billableOperations.onDemandBackupsCreated = 1;
    await checkpoint('backup bajo demanda solicitado');
    await waitFor('backup AVAILABLE', () => verifyBackup(context, call('describe-backup', '--backup-arn', context.backupArn).BackupDescription), (value) => value.BackupDetails.BackupStatus === 'AVAILABLE');
    restoreAttempted = true;
    const restoreResponse = call('restore-table-from-backup', '--target-table-name', context.targetTable, '--backup-arn', context.backupArn, '--billing-mode-override', 'PAY_PER_REQUEST').TableDescription;
    if (restoreResponse?.TableName !== context.targetTable || restoreResponse?.TableArn !== context.targetArn) throw new Error('La respuesta de restauración no corresponde al destino exacto solicitado.');
    const tableId = restoreResponse.TableId || getTable(context.targetTable)?.TableId;
    context = { ...context, restoreProof: { tableName: restoreResponse.TableName, tableArn: restoreResponse.TableArn, tableId, sourceBackupArn: context.backupArn } };
    verifyRestoredTable(context, { ...restoreResponse, TableId: tableId });
    report.restoreProof = context.restoreProof;
    report.billableOperations.tableRestoresRequested = 1;
    await checkpoint('restauración temporal solicitada');
    const restored = await waitFor('tabla restaurada ACTIVE', () => getTable(context.targetTable), (value) => value?.TableStatus === 'ACTIVE');
    verifyRestoredTable(context, restored);
    const restoredMarker = call('get-item', '--table-name', context.targetTable, '--key', JSON.stringify(key), '--consistent-read').Item;
    if (restoredMarker?.pk?.S !== key.pk.S || restoredMarker?.sk?.S !== key.sk.S || restoredMarker?.probe?.S !== probe) throw new Error('El marcador propio no coincide después de restaurar el backup.');
    report.markerVerified = true;
    report.restoreVerifiedAt = new Date().toISOString();
    await checkpoint('marcador restaurado verificado por clave');
  } catch (error) { failure = error; }
  finally {
    const cleanupErrors = [];
    await checkpoint('limpieza de recursos propios');
    let sameAccount = false;
    try { sameAccount = invoke(['sts', 'get-caller-identity']).Account === account; if (!sameAccount) throw new Error('Cuenta AWS distinta durante limpieza.'); }
    catch (error) { cleanupErrors.push(error.message); }
    if (sameAccount) {
      try {
        if (restoreAttempted) {
          let table = getTable(context.targetTable);
          if (table) {
            verifyRestoredTable(context, table);
            if (!['ACTIVE', 'DELETING'].includes(table.TableStatus)) table = await waitFor('tabla temporal disponible para limpieza', () => getTable(context.targetTable), (value) => !value || ['ACTIVE', 'DELETING'].includes(value.TableStatus));
            if (table && table.TableStatus !== 'DELETING') {
              verifyRestoredTable(context, table);
              call('delete-table', '--table-name', context.targetTable);
            }
            await waitFor('eliminación de tabla temporal', () => getTable(context.targetTable), (value) => !value, 10 * 60 * 1000);
          }
        }
        report.cleanup.temporaryTableDeleted = true;
      } catch (error) { cleanupErrors.push(error.message); }
      try {
        if (context.backupArn) {
          let description;
          try { description = call('describe-backup', '--backup-arn', context.backupArn).BackupDescription; }
          catch (error) { if (!missing(error)) throw error; }
          if (description) {
            verifyBackup(context, description);
            call('delete-backup', '--backup-arn', context.backupArn);
            await waitFor('eliminación del backup propio', () => {
              try { return call('describe-backup', '--backup-arn', context.backupArn).BackupDescription; }
              catch (error) { if (missing(error)) return undefined; throw error; }
            }, (value) => !value || value.BackupDetails.BackupStatus === 'DELETED', 10 * 60 * 1000);
          }
        }
        report.cleanup.backupDeleted = true;
      } catch (error) { cleanupErrors.push(error.message); }
      try {
        if (markerAttempted) {
          const source = getTable(sourceTable);
          if (source?.TableArn !== context.sourceArn) throw new Error('ARN de origen inesperado durante limpieza del marcador.');
          const marker = call('get-item', '--table-name', sourceTable, '--key', JSON.stringify(key), '--consistent-read').Item;
          if (marker) {
            if (marker.probe?.S !== probe) throw new Error('El marcador de origen no pertenece a esta ejecución; no se eliminará.');
            call('delete-item', '--table-name', sourceTable, '--key', JSON.stringify(key), '--condition-expression', '#probe = :probe', '--expression-attribute-names', JSON.stringify({ '#probe': 'probe' }), '--expression-attribute-values', JSON.stringify({ ':probe': { S: probe } }));
          }
          if (call('get-item', '--table-name', sourceTable, '--key', JSON.stringify(key), '--consistent-read').Item) throw new Error('El marcador de origen continúa presente después de limpiar.');
        }
        report.cleanup.sourceMarkerDeleted = true;
      } catch (error) { cleanupErrors.push(error.message); }
    }
    report.completedAt = new Date().toISOString();
    report.elapsedSeconds = Math.round((Date.now() - started) / 1000);
    report.status = failure || cleanupErrors.length ? 'failed' : 'succeeded';
    if (failure) report.error = failure.message;
    if (cleanupErrors.length) report.cleanupErrors = cleanupErrors;
    report.stage = 'terminado';
    await save(report);
    if (cleanupErrors.length) failure = new Error([failure?.message, ...cleanupErrors].filter(Boolean).join('; '));
  }
  if (failure) throw failure;
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const environment = args.includes('--environment') ? args[args.indexOf('--environment') + 1] : 'development';
  if (environment !== 'development') throw new Error('La prueba de recuperación sólo admite development.');
  const account = aws(['sts', 'get-caller-identity']).Account;
  const sourceTable = stackOutputs('sedepulso-development-platform', region).AccessTableName;
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.artifacts');
  await mkdir(directory, { recursive: true });
  const save = (report) => writeFile(join(directory, 'recovery-development.json'), JSON.stringify(report, null, 2) + '\n');
  const report = await executeRecovery({ environment, account, sourceTable, save });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  await main().catch((error) => { console.error(`Recuperación development falló: ${error.message}`); process.exitCode = 1; });
}

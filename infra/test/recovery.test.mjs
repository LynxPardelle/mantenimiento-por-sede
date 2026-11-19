import assert from 'node:assert/strict';
import test from 'node:test';
import { executeRecovery, validateRecoveryTargets, verifyBackup, verifyRestoredTable } from '../tools/recovery-check.mjs';

const nonce = 'abc123def456';
const account = '123456789012';
const sourceTable = 'sedepulso-development-platform-AccessTable-ABC123';
const targetTable = `sedepulso-development-recovery-${nonce}`;
const sourceArn = `arn:aws:dynamodb:us-east-1:${account}:table/${sourceTable}`;
const targetArn = `arn:aws:dynamodb:us-east-1:${account}:table/${targetTable}`;
const backupArn = `${sourceArn}/backup/01700000000000-ownbackup`;
const context = { environment: 'development', nonce, account, sourceTable, sourceArn, targetTable, targetArn, backupName: targetTable, backupArn };
const backup = { BackupDetails: { BackupArn: backupArn, BackupName: targetTable, BackupType: 'USER', BackupStatus: 'AVAILABLE' }, SourceTableDetails: { TableName: sourceTable, TableArn: sourceArn } };
const target = { TableName: targetTable, TableArn: targetArn, TableId: '12345678-1234-4234-8234-123456789012', TableStatus: 'ACTIVE', RestoreSummary: { SourceTableArn: sourceArn, SourceBackupArn: backupArn, RestoreInProgress: false } };

test('recovery refuses production and deceptive or source table targets before AWS mutations', async () => {
  let called = false;
  await assert.rejects(executeRecovery({ environment: 'production', sourceTable, account, nonce, invoke: () => { called = true; } }), /development/);
  assert.equal(called, false);
  for (const value of [sourceTable, `${targetTable}-other`, 'sedepulso-production-recovery-abc123def456', 'sedepulso-development-recovery-abc123']) {
    assert.throws(() => validateRecoveryTargets({ ...context, targetTable: value }), /target|destino|temporal/i);
  }
  assert.throws(() => validateRecoveryTargets({ ...context, sourceTable: 'sedepulso-production-platform-AccessTable-ABC123' }), /source|origen/i);
});

test('backup and deletion guards bind account, source ARN, exact backup and restore lineage', () => {
  assert.doesNotThrow(() => verifyBackup(context, backup));
  assert.doesNotThrow(() => verifyRestoredTable(context, target));
  assert.throws(() => verifyBackup(context, { ...backup, BackupDetails: { ...backup.BackupDetails, BackupArn: backupArn.replace(account, '999999999999') } }), /backup/i);
  assert.throws(() => verifyBackup(context, { ...backup, SourceTableDetails: { ...backup.SourceTableDetails, TableArn: targetArn } }), /origen|source/i);
  assert.throws(() => verifyRestoredTable(context, { ...target, TableArn: sourceArn }), /temporal|target|destino/i);
  assert.throws(() => verifyRestoredTable(context, { ...target, RestoreSummary: { ...target.RestoreSummary, SourceBackupArn: `${sourceArn}/backup/other` } }), /backup|restaur/i);
});

test('optional SourceTableArn can be absent when exact backup ARN proves lineage', () => {
  const { SourceTableArn, ...summary } = target.RestoreSummary;
  assert.doesNotThrow(() => verifyRestoredTable(context, { ...target, RestoreSummary: summary }));
});

test('missing RestoreSummary requires immutable table ID proof captured from the successful restore request', () => {
  const restoreProof = { tableName: targetTable, tableArn: targetArn, tableId: target.TableId, sourceBackupArn: backupArn };
  assert.doesNotThrow(() => verifyRestoredTable({ ...context, restoreProof }, { ...target, RestoreSummary: undefined }));
  assert.throws(() => verifyRestoredTable({ ...context, restoreProof }, { ...target, TableId: '99999999-1234-4234-8234-123456789012', RestoreSummary: undefined }), /restaur|backup|inmutable/i);
  assert.throws(() => verifyRestoredTable({ ...context, restoreProof }, { ...target, TableId: '99999999-1234-4234-8234-123456789012' }), /restaur|backup|inmutable/i);
  assert.throws(() => verifyRestoredTable(context, { ...target, RestoreSummary: undefined }), /restaur|backup/i);
});

function awsDouble({ mismatch = false, unsafeTarget = false, omitSummary = false } = {}) {
  const commands = [];
  let marker, restored = false, backupExists = false;
  const invoke = (args) => {
    commands.push(args);
    const operation = args[1];
    const value = (key) => args[args.indexOf(key) + 1];
    if (args[0] === 'sts') return { Account: account };
    if (operation === 'describe-table') {
      if (value('--table-name') === sourceTable) return { Table: { TableName: sourceTable, TableArn: sourceArn, TableStatus: 'ACTIVE' } };
      if (!restored) throw new Error('ResourceNotFoundException');
      return { Table: unsafeTarget ? { ...target, RestoreSummary: { ...target.RestoreSummary, SourceBackupArn: `${sourceArn}/backup/not-owned` } } : omitSummary ? { ...target, RestoreSummary: undefined } : target };
    }
    if (operation === 'put-item') { marker = JSON.parse(value('--item')); return {}; }
    if (operation === 'create-backup') { backupExists = true; return { BackupDetails: backup.BackupDetails }; }
    if (operation === 'describe-backup') {
      if (!backupExists) throw new Error('BackupNotFoundException');
      return { BackupDescription: backup };
    }
    if (operation === 'restore-table-from-backup') { restored = true; return { TableDescription: target }; }
    if (operation === 'get-item') return { Item: mismatch && value('--table-name') === targetTable ? { ...marker, probe: { S: 'changed' } } : marker };
    if (operation === 'delete-table') { assert.equal(value('--table-name'), targetTable); restored = false; return {}; }
    if (operation === 'delete-backup') { assert.equal(value('--backup-arn'), backupArn); backupExists = false; return {}; }
    if (operation === 'delete-item') { assert.equal(value('--table-name'), sourceTable); marker = undefined; return {}; }
    throw new Error(`Unexpected operation ${operation}`);
  };
  return { commands, invoke };
}

test('real workflow verifies one marker by key and deletes only resources it created', async () => {
  const fake = awsDouble();
  const report = await executeRecovery({ environment: 'development', sourceTable, account, nonce, invoke: fake.invoke, sleep: async () => {}, progress: () => {} });
  assert.equal(report.markerVerified, true);
  assert.deepEqual(report.cleanup, { temporaryTableDeleted: true, backupDeleted: true, sourceMarkerDeleted: true });
  const mutationNames = fake.commands.filter((args) => args[1] === 'delete-table').map((args) => args[args.indexOf('--table-name') + 1]);
  assert.deepEqual(mutationNames, [targetTable]);
  assert.ok(fake.commands.every((args) => args[1] !== 'scan'));
  const reads = fake.commands.filter((args) => args[1] === 'get-item');
  assert.ok(reads.every((args) => JSON.parse(args[args.indexOf('--key') + 1]).pk.S === `RECOVERY#${nonce}`));
});

test('failed marker verification still cleans up its own backup, temporary table and source marker', async () => {
  const fake = awsDouble({ mismatch: true });
  await assert.rejects(executeRecovery({ environment: 'development', sourceTable, account, nonce, invoke: fake.invoke, sleep: async () => {}, progress: () => {} }), /marcador|marker/i);
  assert.ok(fake.commands.some((args) => args[1] === 'delete-table'));
  assert.ok(fake.commands.some((args) => args[1] === 'delete-backup'));
  assert.ok(fake.commands.some((args) => args[1] === 'delete-item'));
});

test('workflow still verifies and cleans a restored table when DescribeTable omits RestoreSummary', async () => {
  const fake = awsDouble({ omitSummary: true });
  const report = await executeRecovery({ environment: 'development', sourceTable, account, nonce, invoke: fake.invoke, sleep: async () => {}, progress: () => {} });
  assert.equal(report.markerVerified, true);
  assert.equal(report.cleanup.temporaryTableDeleted, true);
  assert.equal(report.restoreProof.tableId, target.TableId);
});

test('cleanup never deletes an unexpected table with the same temporary name', async () => {
  const fake = awsDouble({ unsafeTarget: true });
  await assert.rejects(executeRecovery({ environment: 'development', sourceTable, account, nonce, invoke: fake.invoke, sleep: async () => {}, progress: () => {} }), /backup|restaur/i);
  assert.equal(fake.commands.some((args) => args[1] === 'delete-table'), false);
  assert.ok(fake.commands.some((args) => args[1] === 'delete-backup'));
  assert.ok(fake.commands.some((args) => args[1] === 'delete-item'));
});

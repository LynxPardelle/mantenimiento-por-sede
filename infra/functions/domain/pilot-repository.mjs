import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { setTimeout as delay } from 'node:timers/promises';
import { digest, fail, siteKey } from './common.mjs';
import { exportedPilotRow } from './pilot-model.mjs';

const registryPartition = 'PILOT#REGISTRY';
const replayedDraft = (record, expectedRevision, fingerprint) => record?.status === 'draft' && record.revision === expectedRevision + 1 && record.lastExpectedRevision === expectedRevision && record.lastFingerprint === fingerprint;
const replayedEnrollment = (record, expectedRevision) => record?.status === 'enrolled' && record.confirmedFromRevision === expectedRevision;

export function createPilotRepository({ client, tableName = process.env.PILOT_TABLE_NAME } = {}) {
  if (!tableName) throw new Error('Pilot table is not configured');
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const key = scope => ({ pk: siteKey(scope), sk: 'PILOT' });
  const get = async scope => (await client.send(new GetCommand({ TableName: tableName, Key: key(scope), ConsistentRead: true }))).Item;
  return {
    get,
    async saveDraft({ scope, actor, expectedRevision, data, now }) {
      const current = await get(scope);
      if (current?.status === 'enrolled') fail(409, 'pilot_already_enrolled');
      const fingerprint = digest(data);
      if ((current?.revision ?? 0) !== expectedRevision) {
        if (replayedDraft(current, expectedRevision, fingerprint)) return current;
        fail(409, 'pilot_revision_conflict');
      }
      const item = { ...data, ...key(scope), status: 'draft', revision: expectedRevision + 1, createdAt: current?.createdAt ?? now, updatedAt: now, createdBy: current?.createdBy ?? actor, lastExpectedRevision: expectedRevision, lastFingerprint: fingerprint };
      try {
        await client.send(new PutCommand({ TableName: tableName, Item: item,
          ...(expectedRevision === 0 ? { ConditionExpression: 'attribute_not_exists(pk)' } : { ConditionExpression: '#revision = :revision AND #status = :draft', ExpressionAttributeNames: { '#revision': 'revision', '#status': 'status' }, ExpressionAttributeValues: { ':revision': expectedRevision, ':draft': 'draft' } }),
        }));
        return item;
      } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') throw error;
        const winner = await get(scope);
        if (replayedDraft(winner, expectedRevision, fingerprint)) return winner;
        fail(409, 'pilot_revision_conflict');
      }
    },
    async enroll({ scope, expectedRevision, record, registry }) {
      const current = await get(scope);
      if (replayedEnrollment(current, expectedRevision)) return current;
      if (!current || current.status !== 'draft' || current.revision !== expectedRevision) fail(409, 'pilot_revision_conflict');
      const safeRegistry = exportedPilotRow(registry);
      if (record.code !== safeRegistry.cohort.code) throw new Error('Pilot registry scope mismatch');
      const item = { ...record, ...key(scope) };
      const exported = { ...safeRegistry, pk: registryPartition, sk: `COHORT#${safeRegistry.cohort.code}` };
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await client.send(new TransactWriteCommand({ TransactItems: [
            { Put: { TableName: tableName, Item: item, ConditionExpression: '#revision = :revision AND #status = :draft', ExpressionAttributeNames: { '#revision': 'revision', '#status': 'status' }, ExpressionAttributeValues: { ':revision': expectedRevision, ':draft': 'draft' } } },
            { Put: { TableName: tableName, Item: exported, ConditionExpression: 'attribute_not_exists(pk)' } },
          ] }));
          return item;
        } catch (error) {
          if (error.name !== 'TransactionCanceledException') throw error;
          const reasons = error.CancellationReasons ?? [];
          if (reasons.some(reason => reason.Code && !['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason.Code))) throw error;
          const winner = await get(scope);
          if (replayedEnrollment(winner, expectedRevision)) return winner;
          if (reasons.some(reason => reason.Code === 'ConditionalCheckFailed') || !winner || winner.revision !== expectedRevision || winner.status !== 'draft') fail(409, 'pilot_revision_conflict');
          if (attempt === 4) throw error;
          await delay(20 * 2 ** attempt);
        }
      }
    },
    async exportRegistry() {
      const cohorts = [];
      const baselines = [];
      const seenCodes = new Set();
      const seenCursors = new Set();
      let cursor;
      let pages = 0;
      do {
        if (++pages > 1000) throw new Error('Pilot registry pagination limit exceeded');
        const page = await client.send(new QueryCommand({ TableName: tableName, ConsistentRead: true, Limit: 100,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk', '#cohort': 'cohort', '#baseline': 'baseline' },
          ExpressionAttributeValues: { ':pk': registryPartition, ':prefix': 'COHORT#' },
          ProjectionExpression: '#cohort, #baseline', ...(cursor ? { ExclusiveStartKey: cursor } : {}),
        }));
        if (!Array.isArray(page.Items)) throw new Error('Pilot registry response incomplete');
        for (const row of page.Items) {
          const sanitized = exportedPilotRow(row);
          if (seenCodes.has(sanitized.cohort.code) || cohorts.length >= 5000) throw new Error('Pilot registry scope duplicate or limit exceeded');
          seenCodes.add(sanitized.cohort.code);
          cohorts.push(sanitized.cohort); baselines.push(sanitized.baseline);
        }
        cursor = page.LastEvaluatedKey;
        if (cursor && Object.keys(cursor).length === 0) cursor = undefined;
        if (cursor) {
          if (Object.keys(cursor).some(name => !['pk', 'sk'].includes(name)) || cursor.pk !== registryPartition || typeof cursor.sk !== 'string' || !/^COHORT#pilot-[a-f0-9]{24}$/.test(cursor.sk) || seenCursors.has(cursor.sk)) throw new Error('Pilot registry cursor invalid');
          seenCursors.add(cursor.sk);
        }
      } while (cursor);
      const result = { schemaVersion: 1, cohorts, baselines };
      if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) throw new Error('Pilot export exceeds invocation payload limit');
      return result;
    },
  };
}

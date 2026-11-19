import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { setTimeout as delay } from 'node:timers/promises';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { assetKey, completionMatches, digest, fail, publicItem, siteKey } from './common.mjs';

export async function createDynamoRepositories({ client, tables = { access: process.env.ACCESS_TABLE_NAME, assets: process.env.ASSETS_TABLE_NAME, inspections: process.env.INSPECTIONS_TABLE_NAME } } = {}) {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const read = async (TableName, Key) => (await client.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  const inspectionKey = (scope, assetId, id) => ({ pk: assetKey(scope, assetId), sk: `INSPECTION#${id}` });

  async function create(TableName, args, key, indexed = false) {
    const operationKey = { pk: siteKey(args.scope), sk: `IDEMPOTENCY#${digest([args.actor, args.operation, args.key])}` };
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const item = { ...key, ...args.item, ...(indexed ? { pendingSiteKey: siteKey(args.scope), pendingDueKey: `${args.item.dueDate}#${args.item.assetId}#${args.item.id}` } : {}) };
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await client.send(new TransactWriteCommand({ TransactItems: [
          { Put: { TableName, Item: { ...operationKey, fingerprint: args.fingerprint, response: args.item, expiresAt }, ConditionExpression: 'attribute_not_exists(pk)' } },
          { Put: { TableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' } },
        ] }));
        return args.item;
      } catch (error) {
        if (error.name !== 'TransactionCanceledException') throw error;
        const reasons = error.CancellationReasons ?? [];
        if (reasons.some(({ Code }) => Code && !['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(Code))) throw error;
        const previous = await read(TableName, operationKey);
        if (previous) {
          if (previous.fingerprint !== args.fingerprint) fail(409, 'idempotency_conflict');
          return previous.response;
        }
        // A competing transaction can still be committing when this read runs.
        // Retry with the same entity and operation keys; atomicity stays intact.
        if (attempt === 4) throw error;
        await delay(20 * 2 ** attempt + Math.floor(Math.random() * 20));
      }
    }
  }

  async function query(TableName, pk, prefix, options) {
    if (options.after !== undefined && !options.after.startsWith(prefix)) fail(400, 'invalid_next_token');
    const result = await client.send(new QueryCommand({ TableName, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix }, Limit: options.limit, ConsistentRead: true, ...(options.after ? { ExclusiveStartKey: { pk, sk: options.after } } : {}) }));
    return { items: (result.Items ?? []).map(publicItem), ...(result.LastEvaluatedKey ? { after: result.LastEvaluatedKey.sk } : {}) };
  }

  return {
    access: { getMembership: (sub) => read(tables.access, { pk: `USER#${sub}`, sk: 'MEMBERSHIP' }) },
    assets: {
      getAsset: async (scope, id) => publicItem(await read(tables.assets, { pk: siteKey(scope), sk: `ASSET#${id}` })),
      createAsset: (args) => create(tables.assets, args, { pk: siteKey(args.scope), sk: `ASSET#${args.item.id}` }),
      listAssets: (scope, options) => query(tables.assets, siteKey(scope), 'ASSET#', options),
    },
    inspections: {
      createInspection: (args) => create(tables.inspections, args, inspectionKey(args.scope, args.item.assetId, args.item.id), true),
      listHistory: (scope, assetId, options) => query(tables.inspections, assetKey(scope, assetId), 'INSPECTION#', options),
      listPending: async (scope, dueThrough, options) => {
        const pendingSiteKey = siteKey(scope);
        let ExclusiveStartKey;
        if (options.after) {
          const match = /^(\d{4}-\d{2}-\d{2})#([A-Za-z0-9_-]{1,128})#([A-Za-z0-9_-]{1,128})$/.exec(options.after);
          if (!match) fail(400, 'invalid_next_token');
          ExclusiveStartKey = { ...inspectionKey(scope, match[2], match[3]), pendingSiteKey, pendingDueKey: options.after };
        }
        const result = await client.send(new QueryCommand({ TableName: tables.inspections, IndexName: 'PendingBySite', KeyConditionExpression: 'pendingSiteKey = :pk AND pendingDueKey <= :through', ExpressionAttributeValues: { ':pk': pendingSiteKey, ':through': `${dueThrough}#\uffff` }, Limit: options.limit, ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}) }));
        return { items: (result.Items ?? []).map(publicItem), ...(result.LastEvaluatedKey ? { after: result.LastEvaluatedKey.pendingDueKey } : {}) };
      },
      completeInspection: async (scope, assetId, id, completion) => {
        const Key = inspectionKey(scope, assetId, id);
        try {
          const result = await client.send(new UpdateCommand({ TableName: tables.inspections, Key, UpdateExpression: 'SET #status = :completed, #result = :result, note = :note, completedBy = :by, completedAt = :at REMOVE pendingSiteKey, pendingDueKey', ConditionExpression: '#status = :pending', ExpressionAttributeNames: { '#status': 'status', '#result': 'result' }, ExpressionAttributeValues: { ':completed': 'completed', ':pending': 'pending', ':result': completion.result, ':note': completion.note, ':by': completion.completedBy, ':at': completion.completedAt }, ReturnValues: 'ALL_NEW' }));
          return publicItem(result.Attributes);
        } catch (error) {
          if (error.name !== 'ConditionalCheckFailedException') throw error;
          const previous = await read(tables.inspections, Key);
          if (!previous) fail(404, 'not_found');
          if (!completionMatches(previous, completion)) fail(409, 'inspection_already_completed');
          return publicItem(previous);
        }
      },
    },
  };
}

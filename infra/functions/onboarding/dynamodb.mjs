import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

export function createOnboardingRepository({ client, tableName = process.env.ACCESS_TABLE_NAME } = {}) {
  if (typeof tableName !== 'string' || !tableName) throw new Error('signup_table_not_configured');
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return {
    getMembership: async (subject) => (await client.send(new GetCommand({ TableName: tableName, Key: { pk: `USER#${subject}`, sk: 'MEMBERSHIP' }, ConsistentRead: true }))).Item,
    createWorkspace: async ({ membership, organization }) => client.send(new TransactWriteCommand({
      TransactItems: [membership, organization].map((Item) => ({ Put: { TableName: tableName, Item, ConditionExpression: 'attribute_not_exists(pk)' } })),
    })),
  };
}

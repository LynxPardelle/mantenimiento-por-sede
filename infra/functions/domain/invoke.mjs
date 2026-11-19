import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { HttpError } from './common.mjs';

const client = new LambdaClient({});

// Direct Lambda invocations require IAM. HTTP request payloads cannot supply
// these top-level events or bypass API Gateway's JWT authorizer.
export async function invokeService(functionName, event) {
  if (!functionName) throw new Error('Service function is not configured');
  const result = await client.send(new InvokeCommand({ FunctionName: functionName, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(event)) }));
  if (result.FunctionError || !result.Payload) throw new Error('Service invocation failed');
  const response = JSON.parse(Buffer.from(result.Payload).toString('utf8'));
  const body = JSON.parse(response.body);
  if (response.statusCode !== 200) throw new HttpError(response.statusCode, body.error ?? 'service_error');
  return body;
}

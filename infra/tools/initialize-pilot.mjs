import { fileURLToPath } from 'node:url';
import { aws, stackOutputs } from './aws.mjs';

const account = aws(['sts', 'get-caller-identity']).Account;
const bucket = stackOutputs('sedepulso-ci-oidc').PilotBucketName;
if (!/^\d{12}$/.test(account) || bucket !== `sedepulso-pilot-${account}-us-east-1`) throw new Error('Unexpected pilot bucket; no registry was changed.');
const body = fileURLToPath(new URL('../pilot/registry-empty.json', import.meta.url));
for (const environment of ['development', 'testing', 'production']) {
  let created = true;
  try {
    aws(['s3api', 'put-object', '--bucket', bucket, '--expected-bucket-owner', account, '--key', `${environment}/registry.json`, '--body', body, '--if-none-match', '*', '--server-side-encryption', 'AES256', '--content-type', 'application/json', '--region', 'us-east-1']);
  } catch (error) {
    if (!/\(PreconditionFailed\)/.test(error.message)) throw error;
    created = false;
  }
  console.log(JSON.stringify({ environment, emptyRegistryCreated: created, existingRegistryPreserved: !created }));
}

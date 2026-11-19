import { buildCiTemplate } from './template.mjs';

// Offline rendering for PR checks: the placeholder account performs no AWS calls.
const account = '123456789012';
console.log(JSON.stringify(buildCiTemplate({
  account,
  providerArn: `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
  hostedZoneId: 'Z123456',
  subjectPrefix: 'repo:LynxPardelle@74871143/mantenimiento-por-sede@1461766091',
}), null, 2));

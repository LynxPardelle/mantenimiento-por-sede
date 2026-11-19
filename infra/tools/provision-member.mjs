import { aws, stackOutputs } from './aws.mjs';

const args = process.argv.slice(2);
const option = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
const environment = option('--environment');
const username = option('--username');
const orgId = option('--org-id');
const siteId = option('--site-id');
const name = option('--site-name');
const role = option('--role');
const timeZone = option('--time-zone') || 'America/Mexico_City';
if (!['development', 'testing', 'production'].includes(environment) || !username || !orgId || !siteId || !name || !['coordinator', 'technician'].includes(role)) {
  throw new Error('Usa --environment development|testing|production --username <Cognito> --org-id <organización> --site-id <sede> --site-name <nombre> --role coordinator|technician [--time-zone America/Mexico_City].');
}
for (const id of [orgId, siteId]) if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('Identificador no válido.');
new Intl.DateTimeFormat('es-MX', { timeZone });
if (!name.trim() || name.length > 120) throw new Error('Nombre de sede no válido.');
const region = 'us-east-1';
const platform = stackOutputs(`sedepulso-${environment}-platform`, region);
const user = aws(['cognito-idp', 'admin-get-user', '--region', region, '--user-pool-id', platform.UserPoolId, '--username', username]);
const sub = user.UserAttributes.find(({ Name }) => Name === 'sub')?.Value;
if (!sub || !user.Enabled) throw new Error('La identidad no existe o está deshabilitada.');
const key = { pk: { S: `USER#${sub}` }, sk: { S: 'MEMBERSHIP' } };
const current = aws(['dynamodb', 'get-item', '--region', region, '--table-name', platform.AccessTableName, '--key', JSON.stringify(key), '--consistent-read']).Item;
if (current?.orgId?.S && current.orgId.S !== orgId) throw new Error('La identidad ya pertenece a otra organización.');
const previous = current?.sites?.L || [];
const sites = previous.filter(({ M }) => M.id?.S !== siteId);
sites.push({ M: { id: { S: siteId }, name: { S: name.trim() }, timeZone: { S: timeZone }, role: { S: role } } });
const item = { ...key, orgId: { S: orgId }, sites: { L: sites } };
const write = ['dynamodb', 'put-item', '--region', region, '--table-name', platform.AccessTableName, '--item', JSON.stringify(item)];
// Fail on a concurrent membership edit rather than silently dropping a site.
if (current) write.push('--condition-expression', 'orgId = :org AND sites = :previous', '--expression-attribute-values', JSON.stringify({ ':org': current.orgId, ':previous': current.sites }));
else write.push('--condition-expression', 'attribute_not_exists(pk)');
aws(write);
console.log(JSON.stringify({ environment, orgId, siteId, role, assignedSites: sites.length }));

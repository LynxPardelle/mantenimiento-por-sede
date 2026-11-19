import { createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const fail = (status, message) => { throw new HttpError(status, message); };
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const response = (statusCode, value) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(value) });
export const guarded = (operation) => async (event) => {
  try { return await operation(event); }
  catch (error) {
    const status = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    return response(status, { error: status === 500 ? 'internal_error' : error.message });
  }
};

export function identifier(value, name = 'id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail(400, `invalid_${name}`);
  return value;
}

export function identityOf(event, internal = false) {
  const claims = internal ? event.identity : event.requestContext?.authorizer?.jwt?.claims;
  if (!claims?.sub || (!internal && claims.token_use !== 'access')) fail(401, 'unauthorized');
  if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)) fail(401, 'unauthorized');
  return { sub: claims.sub };
}

export const internalRequest = (event, action) => event.internalAction === action && !event.requestContext && !event.rawPath && !event.version;

export function httpRoute(event, expression) {
  const match = expression.exec(event.rawPath ?? '');
  if (!match) fail(404, 'not_found');
  return { match, method: event.requestContext?.http?.method };
}

export function jsonBody(event, fields) {
  let raw = event.body;
  if (typeof raw !== 'string') fail(400, 'invalid_json');
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw, 'utf8') > 16384) fail(413, 'payload_too_large');
  let body;
  try { body = JSON.parse(raw); } catch { fail(400, 'invalid_json'); }
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => !fields.includes(key))) fail(400, 'invalid_payload');
  return body;
}

export function text(value, name, max, { optional = false } = {}) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > max || (!optional && value.trim().length === 0) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) fail(400, `invalid_${name}`);
  return value.trim();
}

export function dateOnly(value, name = 'dueDate') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '9999-12-31') fail(400, `invalid_${name}`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, `invalid_${name}`);
  return value;
}

export function idempotencyKey(event) {
  const entry = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === 'idempotency-key');
  if (!entry || typeof entry[1] !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(entry[1])) fail(400, 'invalid_idempotency_key');
  return entry[1];
}

export function pageOptions(event, context) {
  const query = event.queryStringParameters ?? {};
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (query.limit !== undefined && !/^\d{1,3}$/.test(query.limit))) fail(400, 'invalid_limit');
  let after;
  if (query.nextToken !== undefined) {
    try {
      if (typeof query.nextToken !== 'string' || query.nextToken.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(query.nextToken)) throw new Error();
      const cursor = JSON.parse(Buffer.from(query.nextToken, 'base64url').toString('utf8'));
      if (cursor.context !== digest(context) || typeof cursor.after !== 'string' || !/^[A-Za-z0-9_#-]{1,512}$/.test(cursor.after)) throw new Error();
      after = cursor.after;
    } catch { fail(400, 'invalid_next_token'); }
  }
  return { limit, after };
}

export function pageResult(page, context) {
  return { items: page.items, ...(page.after ? { nextToken: Buffer.from(JSON.stringify({ context: digest(context), after: page.after })).toString('base64url') } : {}) };
}

export function scopeFor(authorization, siteId) {
  if (!authorization?.site || authorization.site.id !== siteId) fail(404, 'not_found');
  return { orgId: identifier(authorization.orgId, 'organization'), siteId: identifier(siteId, 'site') };
}

export function publicItem(item) {
  if (!item) return undefined;
  const { pk, sk, pendingSiteKey, pendingDueKey, ...value } = item;
  return value;
}

export const siteKey = ({ orgId, siteId }) => `ORG#${orgId}#SITE#${siteId}`;
export const assetKey = (scope, assetId) => `${siteKey(scope)}#ASSET#${assetId}`;
export const completionMatches = (record, completion) => record.status === 'completed' && record.result === completion.result && record.note === completion.note && record.completedBy === completion.completedBy;

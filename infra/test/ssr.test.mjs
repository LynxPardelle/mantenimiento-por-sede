import test from 'node:test';
import assert from 'node:assert/strict';
import { createSsrHandler } from '../tools/ssr-handler.mjs';

const event = (method = 'GET') => ({
  version: '2.0', rawPath: '/', rawQueryString: '',
  headers: { host: 'untrusted.example', 'x-forwarded-host': 'untrusted.example' },
  requestContext: { http: { method, path: '/', sourceIp: '127.0.0.1', protocol: 'HTTP/1.1' } },
});

test('SSR uses configured public host, never viewer-controlled host or authorization', async () => {
  const handler = createSsrHandler((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<h1>${req.headers.host}</h1><p>${req.headers.authorization || 'anonymous'}</p>`);
  }, 'sedepulso-development.lynxpardelle.com');
  const input = event();
  input.headers.authorization = 'Bearer private-token';
  const result = await handler(input, {});
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /sedepulso-development.lynxpardelle.com/);
  assert.doesNotMatch(result.body, /untrusted|private-token/);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('SSR refuses mutations and missing configuration', async () => {
  assert.throws(() => createSsrHandler(() => {}, ''), /APP_HOST/);
  const handler = createSsrHandler(() => { throw new Error('must not run'); }, 'sedepulso.lynxpardelle.com');
  assert.equal((await handler(event('POST'), {})).statusCode, 405);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../functions/health/index.mjs';

test('devuelve JSON de salud sin consultar dependencias externas', async () => {
  const response = await handler();

  assert.equal(response.statusCode, 200);
  assert.equal(
    response.headers['content-type'],
    'application/json; charset=utf-8',
  );
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
});

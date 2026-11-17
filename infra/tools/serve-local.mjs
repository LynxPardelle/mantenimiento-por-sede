import { createServer } from 'node:http';

import { handler } from '../functions/health/index.mjs';

const hostname = '127.0.0.1';
const port = 4301;

createServer(async (request, response) => {
  if (request.method !== 'GET' || request.url !== '/api/health') {
    response.writeHead(404, {
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const result = await handler();
  response.writeHead(result.statusCode, result.headers);
  response.end(result.body);
}).listen(port, hostname, () => {
  console.log(`API local en http://${hostname}:${port}/api/health`);
});

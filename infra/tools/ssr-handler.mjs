import serverless from 'serverless-http';

/** CloudFront OAC is the only public caller; SSR never receives an operator session. */
export function createSsrHandler(requestHandler, host) {
  if (!host || !/^sedepulso(-development|-testing)?\.lynxpardelle\.com$/.test(host)) {
    throw new Error('APP_HOST debe ser el subdominio configurado de SedePulso.');
  }
  const handle = serverless(requestHandler, { provider: 'aws' });
  return async (event, context) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return { statusCode: 405, headers: { allow: 'GET, HEAD, OPTIONS', 'cache-control': 'no-store' }, body: '' };
    }
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    delete headers.authorization;
    delete headers.cookie;
    Object.assign(headers, { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' });
    const result = await handle({ ...event, cookies: [], headers }, context);
    result.headers = { ...result.headers, 'cache-control': 'no-store' };
    return result;
  };
}

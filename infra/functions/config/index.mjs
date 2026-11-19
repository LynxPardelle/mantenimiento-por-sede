export function handler() {
  const host = process.env.APP_HOST;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify({
      authMode: 'cognito', region: process.env.AWS_REGION,
      userPoolId: process.env.USER_POOL_ID, clientId: process.env.CLIENT_ID,
      authDomain: process.env.AUTH_DOMAIN,
      redirectUri: `https://${host}/auth/callback`, logoutUri: `https://${host}/`,
    }),
  };
}

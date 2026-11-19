// Only the administrator bootstrap discovers IDs; deployment roles cannot widen their scope.
export function discoverUserPools(aws, { account, region = 'us-east-1' }) {
  const pools = {};
  for (const environment of ['development', 'testing', 'production']) {
    let resource;
    try {
      resource = aws(['cloudformation', 'describe-stack-resource', '--stack-name', `sedepulso-${environment}-platform`, '--logical-resource-id', 'UserPool', '--region', region]).StackResourceDetail;
    } catch (error) {
      if (/\bdoes not exist\b/.test(error.message)) continue;
      throw error;
    }
    const poolId = resource?.PhysicalResourceId;
    if (!new RegExp(`^${region}_[A-Za-z0-9]+$`).test(poolId || '')) throw new Error(`UserPool inválido en ${environment}.`);
    const arn = `arn:aws:cognito-idp:${region}:${account}:userpool/${poolId}`;
    const { UserPool } = aws(['cognito-idp', 'describe-user-pool', '--user-pool-id', poolId, '--region', region]);
    if (UserPool?.Arn !== arn || UserPool.UserPoolTags?.Product !== 'sedepulso' || UserPool.UserPoolTags?.Environment !== environment) throw new Error(`El UserPool de ${environment} no tiene el ARN y etiquetas esperados; no se concedieron permisos WAF.`);
    pools[environment] = arn;
  }
  return pools;
}

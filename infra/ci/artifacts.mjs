export function ensureArtifactBucket(aws, { account, region = 'us-east-1' }) {
  if (!/^\d{12}$/.test(account) || region !== 'us-east-1') throw new Error('Cuenta o región de artefactos no válida.');
  const bucket = `sedepulso-artifacts-${account}-${region}`;
  const owned = ['--bucket', bucket, '--expected-bucket-owner', account, '--region', region];
  let created = false;
  try { aws(['s3api', 'head-bucket', ...owned]); }
  catch (error) {
    if (!/\(404\)|\(NotFound\)|\bNoSuchBucket\b/.test(error.message)) throw error;
    aws(['s3api', 'create-bucket', '--bucket', bucket, '--region', region]);
    aws(['s3api', 'put-public-access-block', ...owned, '--public-access-block-configuration', JSON.stringify({ BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true })]);
    aws(['s3api', 'put-bucket-versioning', ...owned, '--versioning-configuration', 'Status=Enabled']);
    created = true;
  }
  const location = aws(['s3api', 'get-bucket-location', ...owned]).LocationConstraint || 'us-east-1';
  if (location !== region) throw new Error(`El bucket de artefactos no está en ${region}; no se modificó su configuración.`);
  const privacy = aws(['s3api', 'get-public-access-block', ...owned]).PublicAccessBlockConfiguration;
  const versioning = aws(['s3api', 'get-bucket-versioning', ...owned]).Status;
  if (!privacy || !['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'].every((key) => privacy[key] === true) || versioning !== 'Enabled') throw new Error('El bucket de artefactos debe estar privado y con versionado Enabled; no se modificó la configuración del bucket existente.');
  return { bucket, created };
}

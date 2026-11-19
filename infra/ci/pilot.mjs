// Administrative observation only. Product Lambdas keep their original service boundaries.
export function addPilotResources(template, { account, region, providerArn, subjectPrefix }) {
  const environments = ['development', 'testing', 'production'];
  const bucketName = `sedepulso-pilot-${account}-${region}`;
  const bucketArn = `arn:aws:s3:::${bucketName}`;
  const document = Statement => ({ Version: '2012-10-17', Statement });
  const allow = (Sid, Action, Resource, Condition) => ({ Sid, Effect: 'Allow', Action, Resource, ...(Condition ? { Condition } : {}) });
  template.Resources.PilotBucket = {
    Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
    Properties: {
      BucketName: bucketName,
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      LifecycleConfiguration: { Rules: environments.map(env => ({ Id: `${env}-reports-180-days`, Status: 'Enabled', Prefix: `${env}/reports/`, ExpirationInDays: 180, NoncurrentVersionExpiration: { NoncurrentDays: 90 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } })) },
      Tags: [{ Key: 'Product', Value: 'sedepulso' }, { Key: 'Purpose', Value: 'private-pilot-observations' }],
    },
  };
  template.Resources.PilotBucketPolicy = {
    Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: { Ref: 'PilotBucket' }, PolicyDocument: document([
      { Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [bucketArn, bucketArn + '/*'], Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
    ]) },
  };
  template.Outputs.PilotBucketName = { Value: { Ref: 'PilotBucket' } };
  for (const env of environments) {
    const id = env[0].toUpperCase() + env.slice(1);
    const table = `arn:aws:dynamodb:${region}:${account}:table/sedepulso-${env}-`;
    template.Resources[id + 'PilotRole'] = {
      Type: 'AWS::IAM::Role', Properties: {
        RoleName: `sedepulso-pilot-${env}-github`, MaxSessionDuration: 3600,
        AssumeRolePolicyDocument: document([{
          Effect: 'Allow', Principal: { Federated: providerArn }, Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': `${subjectPrefix}:environment:${env}` } },
        }]),
        Policies: [{ PolicyName: 'ObservePilotOnly', PolicyDocument: document([
          allow('DiscoverOwnStackOutputs', ['cloudformation:DescribeStacks'], ['platform', 'assets', 'inspections', 'frontend'].map(name => `arn:aws:cloudformation:${region}:${account}:stack/sedepulso-${env}-${name}/*`)),
          allow('ReadEnrolledSiteData', ['dynamodb:Query'], [table + 'assets-*', table + 'inspections-*']),
          allow('ApproximateTableReadiness', ['dynamodb:DescribeTable'], ['platform-*', 'assets-*', 'inspections-*'].map(name => table + name)),
          allow('ObserveAlarms', ['cloudwatch:DescribeAlarms'], `arn:aws:cloudwatch:${region}:${account}:alarm:sedepulso-${env}-*`),
          allow('ReadPrivateRegistryAndReports', ['s3:GetObject'], [`${bucketArn}/${env}/registry.json`, `${bucketArn}/${env}/reports/*`]),
          allow('WritePrivateReportsOnly', ['s3:PutObject'], `${bucketArn}/${env}/reports/*`, { StringEquals: { 's3:x-amz-server-side-encryption': 'AES256' } }),
        ]) }],
        Tags: [{ Key: 'Product', Value: 'sedepulso' }, { Key: 'Environment', Value: env }, { Key: 'Purpose', Value: 'pilot-observer' }],
      },
    };
    template.Outputs[id + 'PilotRoleArn'] = { Value: { 'Fn::GetAtt': [id + 'PilotRole', 'Arn'] } };
  }
}

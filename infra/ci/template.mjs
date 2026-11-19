const environments = ['development', 'testing', 'production'];
const repository = 'LynxPardelle/mantenimiento-por-sede';
const version = '2012-10-17';
const statement = (Sid, Action, Resource, Condition) => ({ Sid, Effect: 'Allow', Action, Resource, ...(Condition ? { Condition } : {}) });
const policy = (Statement) => ({ Version: version, Statement });

export function buildCiTemplate({ account, providerArn, hostedZoneId, subjectPrefix = `repo:${repository}`, region = 'us-east-1', userPoolArns = {} }) {
  if (!/^\d{12}$/.test(account) || region !== 'us-east-1' || !/^Z[A-Z0-9]+$/.test(hostedZoneId)) throw new Error('Parámetros de CI no válidos.');
  if (!/^repo:LynxPardelle(?:@\d+)?\/mantenimiento-por-sede(?:@\d+)?$/.test(subjectPrefix)) throw new Error('El subject OIDC no corresponde al repositorio de SedePulso.');
  for (const [environment, arn] of Object.entries(userPoolArns)) {
    if (!environments.includes(environment) || !new RegExp(`^arn:aws:cognito-idp:${region}:${account}:userpool/${region}_[A-Za-z0-9]+$`).test(arn)) throw new Error('El ARN de UserPool no corresponde a la cuenta o región de SedePulso.');
  }
  if (new Set(Object.values(userPoolArns)).size !== Object.values(userPoolArns).length) throw new Error('Cada ambiente debe tener su propio UserPool.');
  const template = { AWSTemplateFormatVersion: '2010-09-09', Description: 'SedePulso - OIDC por ambiente y roles CloudFormation con boundary runtime', Resources: {}, Outputs: {} };
  const artifacts = `sedepulso-artifacts-${account}-${region}`;
  const globalRegion = { StringEquals: { 'aws:RequestedRegion': region } };
  const signupAclArn = { 'Fn::GetAtt': ['SignupWebAcl', 'Arn'] };
  const match = (FieldToMatch, SearchString, Type = 'NONE') => ({ ByteMatchStatement: { FieldToMatch, SearchString, PositionalConstraint: 'EXACTLY', TextTransformations: [{ Priority: 0, Type }] } });
  template.Resources.SignupWebAcl = {
    Type: 'AWS::WAFv2::WebACL',
    Properties: {
      Name: 'sedepulso-signup-routing', Scope: 'REGIONAL',
      Description: 'Route GET /signup from Cognito to the complete product registration page',
      DefaultAction: { Allow: {} },
      VisibilityConfig: { CloudWatchMetricsEnabled: true, SampledRequestsEnabled: false, MetricName: 'sedepulso-signup-routing' },
      Rules: environments.map((environment, Priority) => ({
        Name: 'signup-' + environment, Priority,
        Statement: { AndStatement: { Statements: [
          match({ Method: {} }, 'GET'),
          match({ UriPath: {} }, '/signup'),
          match({ SingleHeader: { Name: 'host' } }, `sedepulso-${environment}-${account}.auth.${region}.amazoncognito.com`, 'LOWERCASE'),
        ] } },
        Action: { Block: { CustomResponse: { ResponseCode: 302, ResponseHeaders: [{ Name: 'Location', Value: `https://sedepulso${environment === 'production' ? '' : '-' + environment}.lynxpardelle.com/registro` }] } } },
        VisibilityConfig: { CloudWatchMetricsEnabled: true, SampledRequestsEnabled: false, MetricName: 'signup-' + environment },
      })),
      Tags: [{ Key: 'Product', Value: 'sedepulso' }, { Key: 'Purpose', Value: 'signup-routing' }],
    },
  };
  template.Outputs.SignupWebAclArn = { Value: signupAclArn };
  for (const environment of environments) {
    const id = environment[0].toUpperCase() + environment.slice(1);
    const prefix = `sedepulso-${environment}-`;
    const boundary = `arn:aws:iam::${account}:policy/sedepulso-${environment}-runtime-boundary`;
    const serviceRole = `arn:aws:iam::${account}:role/sedepulso-ci-${environment}-cloudformation`;
    const functions = `arn:aws:lambda:${region}:${account}:function:${prefix}*`;
    const tables = `arn:aws:dynamodb:${region}:${account}:table/${prefix}*`;
    const runtimeRoles = `arn:aws:iam::${account}:role/${prefix}*`;
    const stacks = ['platform', 'assets', 'inspections', 'frontend'].map((name) => `arn:aws:cloudformation:${region}:${account}:stack/${prefix}${name}/*`);
    const transform = `arn:aws:cloudformation:${region}:aws:transform/Serverless-2016-10-31`;
    const pool = `arn:aws:cognito-idp:${region}:${account}:userpool/*`;
    const poolTags = { StringEquals: { 'aws:ResourceTag/Product': 'sedepulso', 'aws:ResourceTag/Environment': environment } };
    const initialTags = { StringEquals: { 'aws:RequestTag/Product': 'sedepulso', 'aws:RequestTag/Environment': environment }, StringEqualsIfExists: { 'aws:ResourceTag/Product': 'sedepulso', 'aws:ResourceTag/Environment': environment } };
    const logs = [
      `arn:aws:logs:${region}:${account}:log-group:/aws/lambda/${prefix}*`,
      `arn:aws:logs:${region}:${account}:log-group:${prefix}*`,
    ];
    const cloudfront = ['distribution', 'origin-access-control', 'cache-policy', 'origin-request-policy', 'response-headers-policy'].map((type) => `arn:aws:cloudfront::${account}:${type}/*`);
    const host = `sedepulso${environment === 'production' ? '' : '-' + environment}.lynxpardelle.com`;
    const basicExecution = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';
    template.Resources[id + 'RuntimeBoundary'] = {
      Type: 'AWS::IAM::ManagedPolicy',
      Properties: {
        ManagedPolicyName: `sedepulso-${environment}-runtime-boundary`,
        Description: 'Límite máximo de roles Lambda del ambiente; no concede permisos por sí mismo',
        PolicyDocument: policy([
          statement('WriteOwnLogs', ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'], logs),
          statement('OwnDomainData', ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:ConditionCheckItem'], [tables, tables + '/index/*']),
          statement('InvokeOwnServices', 'lambda:InvokeFunction', functions),
        ]),
      },
    };
    template.Resources[id + 'CloudFormationRole'] = {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: `sedepulso-ci-${environment}-cloudformation`,
        MaxSessionDuration: 3600,
        AssumeRolePolicyDocument: policy([statement('CloudFormationOnly', 'sts:AssumeRole', undefined)]),
        Policies: [{
          PolicyName: 'ManageSedePulsoResources',
          PolicyDocument: policy([
            statement('CreateBoundedRuntimeRoles', 'iam:CreateRole', runtimeRoles, { StringEquals: { 'iam:PermissionsBoundary': boundary } }),
            statement('MaintainRuntimeRoles', ['iam:GetRole', 'iam:GetRolePolicy', 'iam:ListRolePolicies', 'iam:ListAttachedRolePolicies', 'iam:ListRoleTags', 'iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:UpdateAssumeRolePolicy', 'iam:UpdateRole', 'iam:UpdateRoleDescription', 'iam:TagRole', 'iam:UntagRole', 'iam:DeleteRole'], runtimeRoles),
            statement('MaintainBoundary', 'iam:PutRolePermissionsBoundary', runtimeRoles, { StringEquals: { 'iam:PermissionsBoundary': boundary } }),
            statement('BasicExecutionManagedPolicyOnly', ['iam:AttachRolePolicy', 'iam:DetachRolePolicy'], runtimeRoles, { ArnEquals: { 'iam:PolicyARN': basicExecution } }),
            statement('ReadBasicExecutionPolicy', ['iam:GetPolicy', 'iam:GetPolicyVersion'], basicExecution),
            statement('PassRuntimeRolesToLambdaOnly', 'iam:PassRole', runtimeRoles, { StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' } }),
            statement('LambdaResources', ['lambda:CreateFunction', 'lambda:DeleteFunction', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode', 'lambda:UpdateFunctionConfiguration', 'lambda:GetPolicy', 'lambda:AddPermission', 'lambda:RemovePermission', 'lambda:TagResource', 'lambda:UntagResource', 'lambda:ListTags', 'lambda:CreateFunctionUrlConfig', 'lambda:GetFunctionUrlConfig', 'lambda:UpdateFunctionUrlConfig', 'lambda:DeleteFunctionUrlConfig', 'lambda:ListVersionsByFunction'], functions),
            statement('DomainTables', ['dynamodb:CreateTable', 'dynamodb:DescribeTable', 'dynamodb:UpdateTable', 'dynamodb:DeleteTable', 'dynamodb:DescribeContinuousBackups', 'dynamodb:UpdateContinuousBackups', 'dynamodb:DescribeTimeToLive', 'dynamodb:UpdateTimeToLive', 'dynamodb:TagResource', 'dynamodb:UntagResource', 'dynamodb:ListTagsOfResource'], tables),
            statement('ReadReleaseCode', ['s3:GetObject', 's3:GetObjectVersion'], `arn:aws:s3:::${artifacts}/${environment}/*`),
            statement('FrontendBuckets', ['s3:CreateBucket', 's3:DeleteBucket', 's3:ListBucket', 's3:GetBucketLocation', 's3:GetBucketPolicy', 's3:PutBucketPolicy', 's3:DeleteBucketPolicy', 's3:GetBucketPublicAccessBlock', 's3:PutBucketPublicAccessBlock', 's3:GetBucketOwnershipControls', 's3:PutBucketOwnershipControls', 's3:GetBucketVersioning', 's3:PutBucketVersioning', 's3:GetEncryptionConfiguration', 's3:PutEncryptionConfiguration', 's3:GetBucketTagging', 's3:PutBucketTagging'], `arn:aws:s3:::${prefix}*`),
            statement('ReadFrontendBucketState', ['s3:GetAccelerateConfiguration', 's3:GetLifecycleConfiguration', 's3:GetAnalyticsConfiguration', 's3:GetBucketCORS', 's3:GetInventoryConfiguration', 's3:GetBucketLogging', 's3:GetMetricsConfiguration', 's3:GetBucketNotification', 's3:GetReplicationConfiguration', 's3:GetBucketWebsite', 's3:GetBucketObjectLockConfiguration', 's3:GetBucketAcl', 's3:ListTagsForResource', 's3:TagResource', 's3:UntagResource', 's3:GetBucketAbac', 's3:GetIntelligentTieringConfiguration', 's3:GetBucketMetadataTableConfiguration'], `arn:aws:s3:::${prefix}*`),
            statement('CreateTaggedUserPool', 'cognito-idp:CreateUserPool', '*', { StringEquals: { 'aws:RequestTag/Product': 'sedepulso', 'aws:RequestTag/Environment': environment, 'aws:RequestedRegion': region } }),
            statement('ManageUserPool', ['cognito-idp:DescribeUserPool', 'cognito-idp:UpdateUserPool', 'cognito-idp:DeleteUserPool', 'cognito-idp:GetUserPoolMfaConfig', 'cognito-idp:SetUserPoolMfaConfig', 'cognito-idp:AddCustomAttributes', 'cognito-idp:CreateUserPoolClient', 'cognito-idp:DescribeUserPoolClient', 'cognito-idp:UpdateUserPoolClient', 'cognito-idp:DeleteUserPoolClient', 'cognito-idp:ListUserPoolClients', 'cognito-idp:ListUserPoolClientSecrets', 'cognito-idp:CreateUserPoolDomain', 'cognito-idp:UpdateUserPoolDomain', 'cognito-idp:DeleteUserPoolDomain', 'cognito-idp:TagResource', 'cognito-idp:UntagResource', 'cognito-idp:ListTagsForResource'], pool, poolTags),
            statement('ReadUserPoolDomain', 'cognito-idp:DescribeUserPoolDomain', '*', globalRegion),
            // WAF's dependent Cognito authorization does not supply ResourceTag context.
            // Discover the exact tagged pool during administrator bootstrap; omit until it exists.
            ...(userPoolArns[environment] ? [statement('OwnPoolWafAssociation', ['cognito-idp:AssociateWebACL', 'cognito-idp:DisassociateWebACL', 'cognito-idp:GetWebACLForResource'], userPoolArns[environment])] : []),
            statement('SharedSignupAcl', ['wafv2:AssociateWebACL', 'wafv2:GetWebACL', 'wafv2:ListResourcesForWebACL'], signupAclArn),
            statement('ReadOrRemoveOwnPoolAssociation', ['wafv2:GetWebACLForResource', 'wafv2:DisassociateWebACL'], '*', globalRegion),
            statement('ManageHttpApi', ['apigateway:GET', 'apigateway:POST', 'apigateway:PUT', 'apigateway:PATCH', 'apigateway:DELETE'], [`arn:aws:apigateway:${region}::/apis`, `arn:aws:apigateway:${region}::/apis/*`, `arn:aws:apigateway:${region}::/tags/*`]),
            statement('CreateCdnResources', ['cloudfront:CreateDistribution', 'cloudfront:CreateOriginAccessControl', 'cloudfront:CreateCachePolicy', 'cloudfront:CreateOriginRequestPolicy', 'cloudfront:CreateResponseHeadersPolicy'], '*', globalRegion),
            statement('ReadCdnResources', ['cloudfront:GetDistribution', 'cloudfront:GetDistributionConfig', 'cloudfront:GetOriginAccessControl', 'cloudfront:GetCachePolicy', 'cloudfront:GetCachePolicyConfig', 'cloudfront:GetOriginRequestPolicy', 'cloudfront:GetOriginRequestPolicyConfig', 'cloudfront:GetResponseHeadersPolicy', 'cloudfront:GetResponseHeadersPolicyConfig', 'cloudfront:ListTagsForResource'], cloudfront),
            statement('OwnTaggedDistribution', ['cloudfront:UpdateDistribution', 'cloudfront:DeleteDistribution', 'cloudfront:TagResource', 'cloudfront:UntagResource'], cloudfront[0], poolTags),
            statement('InitialDistributionTags', 'cloudfront:TagResource', cloudfront[0], initialTags),
            statement('MaintainUntaggedCdnPolicies', ['cloudfront:UpdateOriginAccessControl', 'cloudfront:DeleteOriginAccessControl', 'cloudfront:UpdateCachePolicy', 'cloudfront:DeleteCachePolicy', 'cloudfront:UpdateOriginRequestPolicy', 'cloudfront:DeleteOriginRequestPolicy', 'cloudfront:UpdateResponseHeadersPolicy', 'cloudfront:DeleteResponseHeadersPolicy'], cloudfront.slice(1)),
            statement('RequestOwnCertificate', 'acm:RequestCertificate', '*', { 'ForAllValues:StringEquals': { 'acm:DomainNames': [host] }, StringEquals: { 'aws:RequestedRegion': region } }),
            statement('ReadCertificate', ['acm:DescribeCertificate', 'acm:ListTagsForCertificate'], `arn:aws:acm:${region}:${account}:certificate/*`),
            statement('OwnTaggedCertificate', ['acm:DeleteCertificate', 'acm:AddTagsToCertificate', 'acm:RemoveTagsFromCertificate', 'acm:UpdateCertificateOptions'], `arn:aws:acm:${region}:${account}:certificate/*`, poolTags),
            statement('InitialCertificateTags', 'acm:AddTagsToCertificate', `arn:aws:acm:${region}:${account}:certificate/*`, initialTags),
            statement('ManageOwnDns', 'route53:ChangeResourceRecordSets', `arn:aws:route53:::hostedzone/${hostedZoneId}`, { 'ForAllValues:StringLike': { 'route53:ChangeResourceRecordSetsNormalizedRecordNames': [host, `_*.${host}`] }, 'ForAllValues:StringEquals': { 'route53:ChangeResourceRecordSetsRecordTypes': ['A', 'AAAA', 'CNAME'] } }),
            statement('ReadOwnZone', ['route53:GetHostedZone', 'route53:ListResourceRecordSets'], `arn:aws:route53:::hostedzone/${hostedZoneId}`),
            statement('ReadDnsChange', 'route53:GetChange', 'arn:aws:route53:::change/*'),
            statement('OwnLogs', ['logs:CreateLogGroup', 'logs:DeleteLogGroup', 'logs:PutRetentionPolicy', 'logs:DeleteRetentionPolicy', 'logs:TagLogGroup', 'logs:UntagLogGroup', 'logs:TagResource', 'logs:UntagResource', 'logs:ListTagsLogGroup', 'logs:ListTagsForResource'], logs),
            statement('DescribeLogGroups', 'logs:DescribeLogGroups', '*', globalRegion),
            statement('ErrorAlarms', ['cloudwatch:PutMetricAlarm', 'cloudwatch:DeleteAlarms', 'cloudwatch:DescribeAlarms', 'cloudwatch:TagResource', 'cloudwatch:UntagResource', 'cloudwatch:ListTagsForResource'], `arn:aws:cloudwatch:${region}:${account}:alarm:${prefix}*`),
            statement('ServerlessTransform', 'cloudformation:CreateChangeSet', transform),
          ]),
        }],
        Tags: [{ Key: 'Product', Value: 'sedepulso' }, { Key: 'Environment', Value: environment }],
      },
    };
    // Trust policies use Principal rather than a resource ARN.
    template.Resources[id + 'CloudFormationRole'].Properties.AssumeRolePolicyDocument.Statement[0].Principal = { Service: 'cloudformation.amazonaws.com' };
    // Split at statement boundaries to respect the 6,144-byte managed-policy limit.
    // The service role cannot modify these bootstrap-owned policies or its own role.
    const permissions = template.Resources[id + 'CloudFormationRole'].Properties.Policies[0].PolicyDocument.Statement;
    const chunks = [];
    let chunk = [];
    for (const item of permissions) {
      if (Buffer.byteLength(JSON.stringify(policy([...chunk, item]))) > 5200 && chunk.length) { chunks.push(chunk); chunk = []; }
      chunk.push(item);
    }
    if (chunk.length) chunks.push(chunk);
    delete template.Resources[id + 'CloudFormationRole'].Properties.Policies;
    template.Resources[id + 'CloudFormationRole'].Properties.ManagedPolicyArns = chunks.map((items, index) => {
      const name = id + 'CloudFormationPolicy' + (index + 1);
      template.Resources[name] = { Type: 'AWS::IAM::ManagedPolicy', Properties: { ManagedPolicyName: `sedepulso-ci-${environment}-resources-${index + 1}`, PolicyDocument: policy(items) } };
      return { Ref: name };
    });
    // HTTP API V2 CreateStage enforces this literal action despite the public IAM catalog.
    // Confirmed with the live CFN provider and an exact-ARN STS probe; see the CI runbook.
    const stageTaggingPolicy = id + 'ApiStageTaggingPolicy';
    template.Resources[stageTaggingPolicy] = {
      Type: 'AWS::IAM::ManagedPolicy',
      Metadata: { 'cfn-lint': { config: { ignore_checks: ['W3037'] } } },
      Properties: {
        ManagedPolicyName: `sedepulso-ci-${environment}-api-stage-tagging`,
        PolicyDocument: policy([statement('CreateTaggedHttpApiStage', ['apigateway:TagResource'], [`arn:aws:apigateway:${region}::/apis/*/stages`, `arn:aws:apigateway:${region}::/apis/*/stages/*`])]),
      },
    };
    template.Resources[id + 'CloudFormationRole'].Properties.ManagedPolicyArns.push({ Ref: stageTaggingPolicy });
    template.Resources[id + 'GitHubRole'] = {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: `sedepulso-ci-${environment}-github`,
        MaxSessionDuration: 3600,
        AssumeRolePolicyDocument: policy([{
          Effect: 'Allow', Principal: { Federated: providerArn }, Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': `${subjectPrefix}:environment:${environment}` } },
        }]),
        Policies: [{
          PolicyName: 'DeployOnlyThisEnvironment',
          PolicyDocument: policy([
            statement('CreateOwnChangeSets', 'cloudformation:CreateChangeSet', stacks, { ArnEquals: { 'cloudformation:RoleArn': serviceRole } }),
            statement('OwnStacks', ['cloudformation:DescribeStacks', 'cloudformation:DescribeStackEvents', 'cloudformation:ListStackResources', 'cloudformation:GetTemplate', 'cloudformation:ExecuteChangeSet', 'cloudformation:DescribeChangeSet', 'cloudformation:DeleteChangeSet'], [...stacks, `arn:aws:cloudformation:${region}:${account}:changeSet/awscli-cloudformation-package-deploy-*/*`]),
            statement('ValidateTemplates', ['cloudformation:ValidateTemplate', 'cloudformation:GetTemplateSummary'], '*', globalRegion),
            statement('ServerlessTransform', 'cloudformation:CreateChangeSet', transform),
            statement('PassOwnCloudFormationRole', 'iam:PassRole', serviceRole, { StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } }),
            statement('ReadArtifactsBucketMetadata', ['s3:ListBucket', 's3:GetBucketLocation'], `arn:aws:s3:::${artifacts}`),
            statement('EnvironmentArtifacts', ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'], `arn:aws:s3:::${artifacts}/${environment}/*`),
            statement('ReadFrontendBucket', ['s3:ListBucket', 's3:GetBucketLocation'], `arn:aws:s3:::${prefix}*`),
            statement('PublishFrontendAssets', ['s3:GetObject', 's3:PutObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'], `arn:aws:s3:::${prefix}*/*`),
            statement('InvalidateFrontend', ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation', 'cloudfront:GetDistribution'], `arn:aws:cloudfront::${account}:distribution/*`, poolTags),
            statement('FindDnsZone', 'route53:ListHostedZonesByName', '*'),
            statement('SmokeIdentities', ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminGetUser', 'cognito-idp:AdminSetUserPassword', 'cognito-idp:AdminInitiateAuth', 'cognito-idp:AdminDeleteUser', 'cognito-idp:ListUsers'], pool, poolTags),
            statement('SmokeData', ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:Query'], [tables, tables + '/index/*']),
            statement('VerifyPrivateLambdaUrl', 'lambda:GetFunctionUrlConfig', functions),
            statement('VerifySignupTrigger', 'lambda:InvokeFunction', `arn:aws:lambda:${region}:${account}:function:${prefix}*PostConfirmation*`),
          ]),
        }],
        Tags: [{ Key: 'Product', Value: 'sedepulso' }, { Key: 'Environment', Value: environment }],
      },
    };
    template.Outputs[id + 'DeployRoleArn'] = { Value: { 'Fn::GetAtt': [id + 'GitHubRole', 'Arn'] } };
    template.Outputs[id + 'CloudFormationRoleArn'] = { Value: { 'Fn::GetAtt': [id + 'CloudFormationRole', 'Arn'] } };
    template.Outputs[id + 'RuntimeBoundaryArn'] = { Value: { Ref: id + 'RuntimeBoundary' } };
  }
  return template;
}

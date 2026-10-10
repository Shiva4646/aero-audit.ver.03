import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';

import { Construct } from 'constructs';

export class AeroAudictStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('Set GEMINI_API_KEY in the deployment environment before synthesizing or deploying.');
    }

    const uploadBucket = new s3.Bucket(this, 'ImageUploadsBucket', {
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const penaltiesTable = new dynamodb.Table(this, 'AeroAuditPenalties', {
      tableName: 'AeroAuditPenalties',
      partitionKey: {
        name: 'clearance_bracket',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const generateUrlFunction = new NodejsFunction(this, 'GenerateUrlFunction', {
      functionName: 'GenerateUrlFunction',
      entry: path.join(__dirname, '..', 'lambda', 'generate-url.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        BUCKET_NAME: uploadBucket.bucketName,
        TABLE_NAME: penaltiesTable.tableName,
      },
    });

    const analyzeClearanceFunction = new NodejsFunction(this, 'AnalyzeClearanceFunction', {
      functionName: 'AnalyzeClearanceFunction',
      entry: path.join(__dirname, '..', 'lambda', 'analyze.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        BUCKET_NAME: uploadBucket.bucketName,
        TABLE_NAME: penaltiesTable.tableName,
        GEMINI_API_KEY: geminiApiKey,
      },
    });

    uploadBucket.grantPut(generateUrlFunction);
    uploadBucket.grantRead(analyzeClearanceFunction);
    penaltiesTable.grantReadData(analyzeClearanceFunction);

    analyzeClearanceFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );

    const api = new apigateway.RestApi(this, 'AeroAuditApi', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['*'],
      },
    });

    api.root
      .addResource('upload-url')
      .addMethod('POST', new apigateway.LambdaIntegration(generateUrlFunction));
    api.root
      .addResource('analyze')
      .addMethod('POST', new apigateway.LambdaIntegration(analyzeClearanceFunction));

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Aero-Audit API Gateway URL',
    });
  }
}

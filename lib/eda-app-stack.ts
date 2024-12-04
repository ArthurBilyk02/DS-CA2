import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Table
    const imageTable = new dynamodb.Table(this, "ImageTable", {
      partitionKey: { name: "fileName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // S3 Bucket
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // SQS Queues
    // Create Dead Letter Queue
    const dlq = new sqs.Queue(this, "DeadLetterQueue", {
      retentionPeriod: cdk.Duration.days(4),
    });

    // Attach DLQ to the main queue
    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      visibilityTimeout: cdk.Duration.seconds(20),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 1,
      },
    });

    const mailerQueue = new sqs.Queue(this, "mailer-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(20),
    });

    // SNS Topic
    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    // Add SQS Subscriptions to SNS Topic
    newImageTopic.addSubscription(new subs.SqsSubscription(imageProcessQueue));
    newImageTopic.addSubscription(new subs.SqsSubscription(mailerQueue));

    // Lambda Functions
    const processImageFn = new lambdanode.NodejsFunction(this, "ProcessImageFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        TABLE_NAME: imageTable.tableName,
      },
    });

    const mailerFn = new lambdanode.NodejsFunction(this, "MailerFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });

    const updateMetadataFn = new lambdanode.NodejsFunction(this, "UpdateMetadataFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/updateMetadata.ts`,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: imageTable.tableName,
      },
    });

    newImageTopic.addSubscription(
      new subs.LambdaSubscription(updateMetadataFn, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ["Caption", "Date", "Photographer"],
          }),
        },
      })
    );

    // Grant SES Permissions to Mailer Lambda
    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    // Set up S3 notification to SNS
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    // Add SQS Event Sources to Lambdas
    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });
    processImageFn.addEventSource(
      new events.SqsEventSource(imageProcessQueue, {
        batchSize: 1,
        maxBatchingWindow: cdk.Duration.seconds(5),
        reportBatchItemFailures: true,
      })
    );

    const newImageMailEventSource = new events.SqsEventSource(mailerQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });
    mailerFn.addEventSource(newImageMailEventSource);

    const rejectionMailerFn = new lambdanode.NodejsFunction(this, "RejectionMailerFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        SES_EMAIL_FROM: "arthurbilyk82@gmail.com",
        SES_EMAIL_TO: "arthurbilyk82@gmail.com",
        SES_REGION: "eu-west-1",
      },
    });
    
    rejectionMailerFn.addEventSource(
      new events.SqsEventSource(dlq, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );
    
    rejectionMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
        resources: ["*"],
      })
    );

    // Grant necessary permissions
    imagesBucket.grantRead(processImageFn);
    imageProcessQueue.grantConsumeMessages(processImageFn); // Allows ProcessImageFn to consume messages from imageProcessQueue
    mailerQueue.grantConsumeMessages(mailerFn);             // Allows MailerFunction to consume messages from mailerQueue
    imageTable.grantWriteData(processImageFn);              // Allows ProcessImageFn to write data to ImageTable
    imageTable.grantWriteData(updateMetadataFn);            // Allows UpdateMetadataFn to write data to ImageTable

    // Output the S3 bucket name
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });
  }
}
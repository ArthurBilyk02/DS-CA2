/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  PutObjectCommandInput,
  GetObjectCommandInput,
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const s3 = new S3Client();
const dynamodb = new DynamoDBClient({ region: "eu-west-1" });

const tableName = process.env.TABLE_NAME;

// Function to log valid uploads to DynamoDB
async function logValidUpload(fileName: string) {
  if (!tableName) {
    throw new Error("TABLE_NAME environment variable is not defined");
  }

  const params = {
    TableName: tableName,
    Item: {
      fileName: { S: fileName },
    },
  };

  await dynamodb.send(new PutItemCommand(params));
}

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);        // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

        // Validate file type
        const match = srcKey.toLowerCase().match(/\.(jpeg|png)$/);
        if (!match) {
          console.error(`Unsupported file type: ${srcKey}`);
          throw new Error(`Unsupported file type: ${srcKey}`);
        }

        console.log(`Processing valid file: ${srcKey}`);

        await logValidUpload(srcKey);
      }
    }
  }
};
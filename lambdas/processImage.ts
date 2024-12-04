import { SQSHandler } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({ region: "eu-west-1" });
const tableName = process.env.TABLE_NAME;

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
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body); // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      for (const messageRecord of snsMessage.Records) {
        const srcKey = decodeURIComponent(
          messageRecord.s3.object.key.replace(/\+/g, " ")
        );

        // Validate file type
        if (!srcKey.toLowerCase().match(/\.(jpeg|png)$/)) {
          console.error(`Unsupported file type: ${srcKey}`);
          throw new Error(`Unsupported file type: ${srcKey}`);
        }

        await logValidUpload(srcKey);
      }
    }
  }
};
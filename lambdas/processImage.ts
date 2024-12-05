import { SQSHandler } from "aws-lambda";
import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";

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

  console.log(`Logging valid upload: ${fileName}`);
  await dynamodb.send(new PutItemCommand(params));
}

async function deleteTableItem(fileName: string) {
  if (!tableName) {
    throw new Error("TABLE_NAME environment variable is not defined");
  }

  const params = {
    TableName: tableName,
    Key: {
      fileName: { S: fileName },
    },
  };

  console.log(`Deleting ${fileName} from DynamoDB`);
  await dynamodb.send(new DeleteItemCommand(params));
}

export const handler: SQSHandler = async (event) => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const recordBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(recordBody.Message);

      if (!Array.isArray(snsMessage.Records)) {
        console.error("SNS message does not contain valid Records:", snsMessage);
        continue;
      }

      for (const messageRecord of snsMessage.Records) {
        const eventName = messageRecord.eventName;

        if (eventName === "ObjectCreated:Put") {
          const srcKey = decodeURIComponent(
            messageRecord.s3.object.key.replace(/\+/g, " ")
          );

          if (!srcKey.toLowerCase().match(/\.(jpeg|png)$/)) {
            console.error(`Unsupported file type: ${srcKey}`);
            throw new Error(`Unsupported file type: ${srcKey}`);
          }

          await logValidUpload(srcKey);
        } else if (eventName === "ObjectRemoved:Delete") {
          const fileName = decodeURIComponent(
            messageRecord.s3.object.key.replace(/\+/g, " ")
          );

          console.log(`Processing delete for file: ${fileName}`);
          await deleteTableItem(fileName);
        }
      }
    } catch (error) {
      console.error("Error processing message:", record.messageId, error);

      // Add failed record to batchItemFailures
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  // Report batch item failures to SQS
  return { batchItemFailures };
};

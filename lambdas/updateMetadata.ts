import { SNSEvent } from "aws-lambda";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({ region: "eu-west-1" });
const tableName = process.env.TABLE_NAME;

export const handler = async (event: SNSEvent) => {
  for (const record of event.Records) {
    try {
      const snsMessage = JSON.parse(record.Sns.Message); // Parse SNS message
      const { id, value } = snsMessage; // Extract image ID and metadata value
      const metadataType = record.Sns.MessageAttributes.metadata_type?.Value;

      if (!id || !value || !metadataType) {
        console.error("Invalid metadata message:", snsMessage);
        continue;
      }

      const params = {
        TableName: tableName,
        Key: { fileName: { S: id } },
        UpdateExpression: `SET #metadata = :value`,
        ExpressionAttributeNames: {
          "#metadata": metadataType,
        },
        ExpressionAttributeValues: {
          ":value": { S: value },
        },
      };

      await dynamodb.send(new UpdateItemCommand(params));
      console.log(`Metadata updated for image ${id}: ${metadataType} = ${value}`);
    } catch (error) {
      console.error("Error processing metadata message:", error);
    }
  }
};

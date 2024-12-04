import { SQSHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";

if (!SES_EMAIL_FROM || !SES_EMAIL_TO || !SES_REGION) {
  throw new Error(
    "Please add the SES_EMAIL_TO, SES_EMAIL_FROM, and SES_REGION environment variables in an env.js file located in the root directory"
  );
}

type RejectionDetails = {
  fileKey: string;
  reason: string;
};

const sesClient = new SESClient({ region: SES_REGION });

export const handler: SQSHandler = async (event: any) => {
  console.log("Event received:", JSON.stringify(event));
  for (const record of event.Records) {
    try {
      const recordBody = JSON.parse(record.body); // Parse SQS message
      const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message
      const fileKey = extractFileKey(snsMessage);

      if (!fileKey) {
        console.error("No fileKey found in message. Skipping...");
        continue;
      }

      console.log(`Processing rejected file: ${fileKey}`);

      const rejectionDetails: RejectionDetails = {
        fileKey,
        reason: "Unsupported file type",
      };

      const emailParams = createEmailParams(rejectionDetails);
      await sesClient.send(new SendEmailCommand(emailParams));

      console.log(`Rejection email sent for file: ${fileKey}`);
    } catch (error) {
      console.error("Error processing record:", error);
    }
  }
};

function extractFileKey(snsMessage: any): string | null {
  try {
    const s3Record = snsMessage.Records[0]?.s3;
    if (s3Record?.object?.key) {
      return decodeURIComponent(s3Record.object.key.replace(/\+/g, " "));
    }
  } catch (error) {
    console.error("Error extracting file key:", error);
  }
  return null;
}

function createEmailParams({ fileKey, reason }: RejectionDetails): SendEmailCommandInput {
  return {
    Destination: {
      ToAddresses: [SES_EMAIL_TO],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: getHtmlContent(fileKey, reason),
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: `File Rejection Notification`,
      },
    },
    Source: SES_EMAIL_FROM,
  };
}

function getHtmlContent(fileKey: string, reason: string): string {
  return `
    <html>
      <body>
        <h2>File Rejection Notice</h2>
        <p style="font-size:18px">The file <b>${fileKey}</b> was rejected for the following reason:</p>
        <p style="font-size:18px; color: red;"><b>${reason}</b></p>
      </body>
    </html>
  `;
}

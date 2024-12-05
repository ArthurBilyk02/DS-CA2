import { SQSHandler } from "aws-lambda";
import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";

const SES_EMAIL_FROM = process.env.SES_EMAIL_FROM;
const SES_EMAIL_TO = process.env.SES_EMAIL_TO;
const SES_REGION = process.env.SES_REGION;

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
  throw new Error(
    "Please add the SES_EMAIL_TO, SES_EMAIL_FROM, and SES_REGION environment variables in your configuration."
  );
}

type ContactDetails = {
  name: string;
  email: string;
  message: string;
};

const client = new SESClient({ region: SES_REGION });

export const handler: SQSHandler = async (event: any) => {
  console.log("Event ", JSON.stringify(event));

  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);
    const snsMessage = JSON.parse(recordBody.Message);

    if (snsMessage.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        
        if (!srcKey.toLowerCase().match(/\.(jpeg|png)$/)) {
          console.log(`Skipping confirmation email for invalid file type: ${srcKey}`);
          continue;
        }

        try {
          const { name, email, message }: ContactDetails = {
            name: "The Photo Album",
            email: SES_EMAIL_FROM,
            message: `We received your Image. Its URL is s3://${srcBucket}/${srcKey}`,
          };

          const params = sendEmailParams({ name, email, message });
          await client.send(new SendEmailCommand(params));

          console.log(`Email successfully sent for image: ${srcKey}`);
        } catch (error) {
          console.log("ERROR is: ", error);
        }
      }
    }
  }
};

function sendEmailParams({ name, email, message }: ContactDetails): SendEmailCommandInput {
  return {
    Destination: {
      ToAddresses: [SES_EMAIL_TO!],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: getHtmlContent({ name, email, message }),
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: `New Image Uploaded`,
      },
    },
    Source: SES_EMAIL_FROM,
  };
}

function getHtmlContent({ name, email, message }: ContactDetails): string {
  return `
    <html>
      <body>
        <h2>Sent from: </h2>
        <ul>
          <li style="font-size:18px">👤 <b>${name}</b></li>
          <li style="font-size:18px">✉️ <b>${email}</b></li>
        </ul>
        <p style="font-size:18px">${message}</p>
      </body>
    </html> 
  `;
}

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { ImplementFeatureMessage, ReviewPRMessage, ImplementReviewFixMessage, ResumeJobMessage } from "@remote-kiro/common";

const sqsClient = new SQSClient({});

function getQueueUrl(): string {
  const url = process.env.JOB_QUEUE_URL;
  if (!url) {
    throw new Error("JOB_QUEUE_URL environment variable is not set");
  }
  return url;
}

export async function publishImplementFeature(data: ImplementFeatureMessage): Promise<void> {
  const command = new SendMessageCommand({
    QueueUrl: getQueueUrl(),
    MessageBody: JSON.stringify(data),
  });
  await sqsClient.send(command);
}

export async function publishReviewPR(data: ReviewPRMessage): Promise<void> {
  const command = new SendMessageCommand({
    QueueUrl: getQueueUrl(),
    MessageBody: JSON.stringify(data),
  });
  await sqsClient.send(command);
}

export async function publishImplementReviewFix(data: ImplementReviewFixMessage): Promise<void> {
  const command = new SendMessageCommand({
    QueueUrl: getQueueUrl(),
    MessageBody: JSON.stringify(data),
  });
  await sqsClient.send(command);
}

export async function publishResumeJob(data: ResumeJobMessage): Promise<void> {
  const command = new SendMessageCommand({
    QueueUrl: getQueueUrl(),
    MessageBody: JSON.stringify(data),
  });
  await sqsClient.send(command);
}

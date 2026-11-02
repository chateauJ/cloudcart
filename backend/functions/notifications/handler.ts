import { SNSEvent, SNSEventRecord } from "aws-lambda";
import { OrderCreatedDetail } from "../../shared/types";

// SNS invokes Lambda asynchronously, and a thrown error makes Lambda retry the whole event.
// This consumer only logs, so it never throws on bad input - retrying a malformed message can't fix it.
export async function handler(event: SNSEvent): Promise<void> {
  for (const record of event.Records) {
    const detail = parseDetail(record);

    if (!detail) {
      // The raw message makes a contract mismatch diagnosable from the log alone - it carries no secrets
      console.error(
        JSON.stringify({ message: "unrecognized notification", snsMessageId: record.Sns.MessageId, raw: record.Sns.Message }),
      );
      continue;
    }

    // Stand-in for sending an email/SMS: the line a customer-facing message would be built from
    console.log(
      JSON.stringify({
        message: "order notification",
        notification: `Order ${detail.orderId} received - total $${Number(detail.total).toFixed(2)}`,
        ...detail,
        snsMessageId: record.Sns.MessageId,
      }),
    );
  }
}

function parseDetail(record: SNSEventRecord): OrderCreatedDetail | null {
  try {
    // The SNS message is the whole EventBridge event - the same envelope SQS delivers to Inventory
    const event = JSON.parse(record.Sns.Message) as { detail?: Partial<OrderCreatedDetail> };
    const detail = event.detail;

    if (
      typeof detail?.orderId !== "string" ||
      typeof detail.userId !== "string" ||
      typeof detail.total !== "string" ||
      !Number.isFinite(Number(detail.total)) ||
      typeof detail.createdAt !== "string"
    ) {
      return null;
    }

    return { orderId: detail.orderId, userId: detail.userId, total: detail.total, createdAt: detail.createdAt };
  } catch {
    return null;
  }
}

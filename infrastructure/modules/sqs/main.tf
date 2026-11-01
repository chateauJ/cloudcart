resource "aws_sqs_queue" "dlq" { # failed messages park here after max_receive_count attempts instead of retrying forever
  name                      = "${var.queue_name}-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "this" { # visibility timeout must be >= 6x the consumer Lambda's timeout
  name                       = var.queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = var.max_receive_count })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" { # only this module's main queue may use the DLQ
  queue_url            = aws_sqs_queue.dlq.id
  redrive_allow_policy = jsonencode({ redrivePermission = "byQueue", sourceQueueArns = [aws_sqs_queue.this.arn] })
}

output "queue_arn" {
  description = "ARN of the main queue - EventBridge target, and the Inventory Lambda's event source"
  value       = aws_sqs_queue.this.arn
}

output "queue_url" {
  description = "URL of the main queue - SQS API calls (CLI, queue policy) address queues by URL, not ARN"
  value       = aws_sqs_queue.this.id
}

output "dlq_arn" {
  description = "ARN of the dead-letter queue"
  value       = aws_sqs_queue.dlq.arn
}

output "dlq_url" {
  description = "URL of the dead-letter queue - inspect or redrive failed messages"
  value       = aws_sqs_queue.dlq.id
}

output "dlq_name" {
  description = "Name of the dead-letter queue - CloudWatch alarm dimension (Milestone 5)"
  value       = aws_sqs_queue.dlq.name
}

output "queue_name" {
  description = "Name of the main queue - CloudWatch alarm dimension"
  value       = aws_sqs_queue.this.name
}

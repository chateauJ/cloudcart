output "topic_arn" {
  description = "ARN of the topic - EventBridge target, and the resource its topic policy protects"
  value       = aws_sns_topic.this.arn
}

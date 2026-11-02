output "ops_alerts_topic_arn" {
  description = "ARN of the ops alerts topic - every alarm notifies it on ALARM and on recovery to OK"
  value       = aws_sns_topic.ops_alerts.arn
}

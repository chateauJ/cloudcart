output "ops_alerts_topic_arn" {
  description = "ARN of the ops alerts topic - every alarm notifies it on ALARM and on recovery to OK"
  value       = aws_sns_topic.ops_alerts.arn
}

output "dashboard_url" {
  description = "Console link to the CloudWatch dashboard"
  value       = "https://${local.region}.console.aws.amazon.com/cloudwatch/home?region=${local.region}#dashboards/dashboard/${aws_cloudwatch_dashboard.this.dashboard_name}"
}

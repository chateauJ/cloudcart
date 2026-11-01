output "event_bus_name" {
  description = "Name of the custom event bus - for CLI testing and future rules"
  value       = aws_cloudwatch_event_bus.this.name
}

output "event_bus_arn" {
  description = "ARN of the custom event bus"
  value       = aws_cloudwatch_event_bus.this.arn
}

output "pipe_name" {
  description = "Name of the orders pipe - CloudWatch metrics/alarm dimension (Milestone 5)"
  value       = aws_pipes_pipe.orders.name
}

output "order_created_rule_arn" {
  description = "ARN of the OrderCreated rule - scopes target permissions to this rule"
  value       = aws_cloudwatch_event_rule.order_created.arn
}

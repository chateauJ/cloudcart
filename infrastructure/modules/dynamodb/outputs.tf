output "table_name" {
  description = "Name of the created table - callers (e.g. seed data resources) need this as a plain string"
  value       = aws_dynamodb_table.this.name
}

output "table_arn" {
  description = "ARN of the created table - used to scope least-privilege IAM policy statements to this table instead of a wildcard resource"
  value       = aws_dynamodb_table.this.arn
}

output "stream_arn" {
  description = "Stream ARN of the created table - the EventBridge Pipe source once a caller enables streams (e.g. the Orders table); empty/unused when stream_enabled is false"
  value       = aws_dynamodb_table.this.stream_arn
}

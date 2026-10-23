output "function_name" {
  description = "Name of the deployed function - used for CLI invokes and CloudWatch lookups"
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "ARN of the deployed function - used when granting other services (e.g. API Gateway) permission to invoke it"
  value       = aws_lambda_function.this.arn
}

output "invoke_arn" {
  description = "API Gateway-specific invoke ARN - the integration URI for an HTTP API Lambda proxy integration"
  value       = aws_lambda_function.this.invoke_arn
}

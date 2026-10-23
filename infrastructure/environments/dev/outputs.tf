output "products_table_name" {
  description = "Name of the dev Products table - lets you confirm it with the AWS CLI/console, and will feed the Products Lambda's environment variables later"
  value       = module.products_table.table_name
}

output "products_table_arn" {
  description = "ARN of the dev Products table - will scope the Products Lambda's IAM policy to this table instead of a wildcard resource"
  value       = module.products_table.table_arn
}

output "products_lambda_function_name" {
  description = "Name of the dev Products Lambda - used with `aws lambda invoke` to test it directly, without API Gateway"
  value       = module.products_lambda.function_name
}

output "api_endpoint" {
  description = "Base URL of the dev HTTP API - curl it to test, and the frontend's API base URL later"
  value       = module.api.api_endpoint
}

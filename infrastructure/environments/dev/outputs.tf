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

output "carts_table_name" {
  description = "Name of the dev Carts table - inspect stored carts with the AWS CLI while testing"
  value       = module.carts_table.table_name
}

output "cart_lambda_function_name" {
  description = "Name of the dev Cart Lambda - find its logs at /aws/lambda/<this name>"
  value       = module.cart_lambda.function_name
}

output "orders_table_name" {
  description = "Name of the dev Orders table - inspect created orders with the AWS CLI while testing"
  value       = module.orders_table.table_name
}

output "orders_table_stream_arn" {
  description = "Stream ARN of the Orders table - the EventBridge Pipe source in Milestone 4"
  value       = module.orders_table.stream_arn
}

output "orders_lambda_function_name" {
  description = "Name of the dev Orders Lambda - find its logs at /aws/lambda/<this name>"
  value       = module.orders_lambda.function_name
}

output "cognito_user_pool_id" {
  description = "Dev user pool ID - create test users with the AWS CLI, and the frontend's Cognito config later"
  value       = module.auth.user_pool_id
}

output "cognito_client_id" {
  description = "Dev app client ID - used to log in and get a token, and the frontend's Cognito config later"
  value       = module.auth.client_id
}

output "api_endpoint" {
  description = "Base URL of the dev HTTP API - curl it to test, and the frontend's API base URL later"
  value       = module.api.api_endpoint
}

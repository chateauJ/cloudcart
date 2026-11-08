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

output "order_queue_url" {
  description = "Dev order queue URL - receive OrderCreated messages with the AWS CLI while testing"
  value       = module.order_queue.queue_url
}

output "order_dlq_url" {
  description = "Dev order DLQ URL - check for messages that failed processing"
  value       = module.order_queue.dlq_url
}

output "event_bus_name" {
  description = "Dev custom event bus name"
  value       = module.order_events.event_bus_name
}

output "inventory_lambda_function_name" {
  description = "Dev Inventory Lambda name - its logs show each order's processing outcome"
  value       = module.inventory_lambda.function_name
}

output "order_notifications_topic_arn" {
  description = "Dev order notifications topic ARN - check its subscriptions with the AWS CLI"
  value       = module.order_notifications_topic.topic_arn
}

output "notifications_lambda_function_name" {
  description = "Dev Notifications Lambda name - its logs show one line per notified order"
  value       = module.notifications_lambda.function_name
}

output "api_endpoint" {
  description = "Base URL of the dev HTTP API - curl it to test, and the frontend's API base URL later"
  value       = module.api.api_endpoint
}

output "ops_alerts_topic_arn" {
  description = "Dev ops alerts topic ARN - add more subscribers (Slack, PagerDuty) here later"
  value       = module.monitoring.ops_alerts_topic_arn
}

output "dashboard_url" {
  description = "Dev CloudWatch dashboard - open it in a browser"
  value       = module.monitoring.dashboard_url
}

output "site_url" {
  description = "Public URL of the hosted storefront (CloudFront)"
  value       = module.site.url
}

output "site_bucket_name" {
  description = "Bucket the deploy job uploads the frontend build to"
  value       = module.site.bucket_name
}

output "site_distribution_id" {
  description = "CloudFront distribution the deploy job invalidates after an upload"
  value       = module.site.distribution_id
}

output "tenants_table_name" {
  description = "Tenants table - one item per business sharing this deployment"
  value       = module.tenants_table.table_name
}

output "storefront_tenant_id" {
  description = "Tenant the hosted storefront is built for - sent as X-Tenant-Id on every API call"
  value       = var.storefront_tenant_id

  precondition {
    condition     = contains(keys(local.tenants), var.storefront_tenant_id)
    error_message = "storefront_tenant_id must be a tenant in tenants.json."
  }
}

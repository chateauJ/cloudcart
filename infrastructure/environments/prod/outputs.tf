output "products_table_name" {
  value = module.app.products_table_name
}

output "products_table_arn" {
  value = module.app.products_table_arn
}

output "products_lambda_function_name" {
  value = module.app.products_lambda_function_name
}

output "carts_table_name" {
  value = module.app.carts_table_name
}

output "cart_lambda_function_name" {
  value = module.app.cart_lambda_function_name
}

output "orders_table_name" {
  value = module.app.orders_table_name
}

output "orders_table_stream_arn" {
  value = module.app.orders_table_stream_arn
}

output "orders_lambda_function_name" {
  value = module.app.orders_lambda_function_name
}

output "cognito_user_pool_id" {
  value = module.app.cognito_user_pool_id
}

output "cognito_client_id" {
  value = module.app.cognito_client_id
}

output "order_queue_url" {
  value = module.app.order_queue_url
}

output "order_dlq_url" {
  value = module.app.order_dlq_url
}

output "event_bus_name" {
  value = module.app.event_bus_name
}

output "inventory_lambda_function_name" {
  value = module.app.inventory_lambda_function_name
}

output "order_notifications_topic_arn" {
  value = module.app.order_notifications_topic_arn
}

output "notifications_lambda_function_name" {
  value = module.app.notifications_lambda_function_name
}

output "api_endpoint" {
  value = module.app.api_endpoint
}

output "ops_alerts_topic_arn" {
  value = module.app.ops_alerts_topic_arn
}

output "dashboard_url" {
  value = module.app.dashboard_url
}

output "site_url" {
  value = module.app.site_url
}

output "site_bucket_name" {
  value = module.app.site_bucket_name
}

output "site_distribution_id" {
  value = module.app.site_distribution_id
}

output "tenants_table_name" {
  value = module.app.tenants_table_name
}

output "storefront_tenant_id" {
  value = module.app.storefront_tenant_id
}

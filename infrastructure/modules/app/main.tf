data "aws_caller_identity" "current" {}

# Pool tenancy: one deployment serves many businesses, and every table is partitioned by tenantId,
# so a tenant's data can only be reached with a key that names that tenant
module "tenants_table" {
  source        = "../dynamodb"
  table_name    = "${var.project_name}-${var.environment}-tenants"
  hash_key_name = "tenantId"
}

module "products_table" {
  source         = "../dynamodb"
  table_name     = "${var.project_name}-${var.environment}-products"
  hash_key_name  = "tenantId"
  range_key_name = "productId" # one Query lists a tenant's whole catalog
  range_key_type = "S"
}

module "products_lambda" {
  source                   = "../lambda"
  function_name            = "${var.project_name}-${var.environment}-products"
  dist_dir                 = "${var.lambda_dist_dir}/products"
  permissions_boundary_arn = local.permissions_boundary_arn

  environment_variables = {
    PRODUCTS_TABLE_NAME = module.products_table.table_name
    TENANTS_TABLE_NAME  = module.tenants_table.table_name
  }

  dynamodb_access = [
    {
      actions       = ["dynamodb:GetItem", "dynamodb:Query"] # Query, not Scan: listing is always within one tenant
      resource_arns = [module.products_table.table_arn]
    },
    {
      actions       = ["dynamodb:GetItem"]
      resource_arns = [module.tenants_table.table_arn]
    }
  ]
}

module "carts_table" {
  source         = "../dynamodb"
  table_name     = "${var.project_name}-${var.environment}-carts"
  hash_key_name  = "tenantId"
  range_key_name = "userId" # one shopper account can hold a cart at each store
  range_key_type = "S"
}

module "cart_lambda" {
  source                   = "../lambda"
  function_name            = "${var.project_name}-${var.environment}-cart"
  dist_dir                 = "${var.lambda_dist_dir}/cart"
  permissions_boundary_arn = local.permissions_boundary_arn

  environment_variables = {
    CARTS_TABLE_NAME    = module.carts_table.table_name
    PRODUCTS_TABLE_NAME = module.products_table.table_name # to check a product exists before adding it
    TENANTS_TABLE_NAME  = module.tenants_table.table_name
  }

  dynamodb_access = [
    {
      actions       = ["dynamodb:GetItem", "dynamodb:PutItem"]
      resource_arns = [module.carts_table.table_arn]
    },
    {
      actions       = ["dynamodb:GetItem"] # read-only: the cart never writes to products
      resource_arns = [module.products_table.table_arn]
    },
    {
      actions       = ["dynamodb:GetItem"]
      resource_arns = [module.tenants_table.table_arn]
    }
  ]
}

locals {
  orders_user_index_name   = "tenantUser-createdAt-index"
  permissions_boundary_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${var.project_name}-workload-boundary"
}

module "orders_table" {
  source         = "../dynamodb"
  table_name     = "${var.project_name}-${var.environment}-orders"
  hash_key_name  = "tenantId"
  range_key_name = "orderId"
  range_key_type = "S"
  stream_enabled = true
  global_secondary_indexes = [
    {
      name            = local.orders_user_index_name
      hash_key        = "tenantUser" # "<tenantId>#<userId>": a shopper's order history at one store
      hash_key_type   = "S"
      range_key       = "createdAt" # ISO-8601 strings sort chronologically
      range_key_type  = "S"
      projection_type = "ALL"
    }
  ]
}

module "orders_lambda" {
  source                   = "../lambda"
  function_name            = "${var.project_name}-${var.environment}-orders"
  dist_dir                 = "${var.lambda_dist_dir}/orders"
  permissions_boundary_arn = local.permissions_boundary_arn
  environment_variables = {
    ORDERS_TABLE_NAME      = module.orders_table.table_name
    ORDERS_USER_INDEX_NAME = local.orders_user_index_name
    CARTS_TABLE_NAME       = module.carts_table.table_name
    PRODUCTS_TABLE_NAME    = module.products_table.table_name
    TENANTS_TABLE_NAME     = module.tenants_table.table_name
  }
  dynamodb_access = [
    {
      actions       = ["dynamodb:PutItem", "dynamodb:GetItem"]
      resource_arns = [module.orders_table.table_arn]
    },
    {
      actions       = ["dynamodb:Query"]
      resource_arns = ["${module.orders_table.table_arn}/index/${local.orders_user_index_name}"] # a GSI has its own ARN; the table grant doesn't cover it
    },
    {
      actions       = ["dynamodb:GetItem", "dynamodb:DeleteItem"]
      resource_arns = [module.carts_table.table_arn]
    },
    {
      actions       = ["dynamodb:BatchGetItem"]
      resource_arns = [module.products_table.table_arn]
    },
    {
      actions       = ["dynamodb:GetItem"]
      resource_arns = [module.tenants_table.table_arn]
    }
  ]
}

module "order_queue" {
  source     = "../sqs"
  queue_name = "${var.project_name}-${var.environment}-order-queue"
}

module "notifications_lambda" {
  source                   = "../lambda"
  function_name            = "${var.project_name}-${var.environment}-notifications"
  dist_dir                 = "${var.lambda_dist_dir}/notifications"
  permissions_boundary_arn = local.permissions_boundary_arn
}

module "order_notifications_topic" {
  source             = "../sns"
  topic_name         = "${var.project_name}-${var.environment}-order-notifications"
  lambda_subscribers = { notifications = module.notifications_lambda.function_arn }
}

module "order_events" {
  source                   = "../order-events"
  name_prefix              = "${var.project_name}-${var.environment}"
  orders_stream_arn        = module.orders_table.stream_arn
  order_queue_arn          = module.order_queue.queue_arn
  order_queue_url          = module.order_queue.queue_url
  notifications_topic_arn  = module.order_notifications_topic.topic_arn
  permissions_boundary_arn = local.permissions_boundary_arn
}

module "inventory_lambda" {
  source                   = "../lambda"
  function_name            = "${var.project_name}-${var.environment}-inventory"
  dist_dir                 = "${var.lambda_dist_dir}/inventory"
  permissions_boundary_arn = local.permissions_boundary_arn
  environment_variables = {
    ORDERS_TABLE_NAME   = module.orders_table.table_name
    PRODUCTS_TABLE_NAME = module.products_table.table_name
  }
  dynamodb_access = [
    {
      actions       = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
      resource_arns = [module.orders_table.table_arn]
    },
    {
      actions       = ["dynamodb:UpdateItem"]
      resource_arns = [module.products_table.table_arn]
    }
  ]
  sqs_event_source = { queue_arn = module.order_queue.queue_arn }
}

module "auth" {
  source                    = "../cognito"
  user_pool_name            = "${var.project_name}-${var.environment}-users"
  enable_password_auth_flow = var.enable_password_auth_flow
  deletion_protection       = var.cognito_deletion_protection
}

module "site" {
  source      = "../static-site"
  name_prefix = "${var.project_name}-${var.environment}"
  api_domain  = trimprefix(module.api.api_endpoint, "https://") # served under the storefront's /api/*
}

module "api" {
  source             = "../api-gateway"
  api_name           = "${var.project_name}-${var.environment}-api"
  cors_allow_origins = var.cors_allow_origins # local development only - the hosted storefront calls /api on its own origin
  integrations = {
    products = {
      function_name = module.products_lambda.function_name
      invoke_arn    = module.products_lambda.invoke_arn
    }
    cart = {
      function_name = module.cart_lambda.function_name
      invoke_arn    = module.cart_lambda.invoke_arn
    }
    orders = {
      function_name = module.orders_lambda.function_name
      invoke_arn    = module.orders_lambda.invoke_arn
    }
  }
  routes = {
    "GET /tenant"             = { integration = "products" } # the storefront's name and tagline
    "GET /products"           = { integration = "products" }
    "GET /products/{id}"      = { integration = "products" } # {id} must match event.pathParameters.id in the handler
    "GET /cart"               = { integration = "cart", authorization_required = true }
    "POST /cart/items"        = { integration = "cart", authorization_required = true }
    "DELETE /cart/items/{id}" = { integration = "cart", authorization_required = true } # {id} here is a productId
    "POST /orders"            = { integration = "orders", authorization_required = true }
    "GET /orders"             = { integration = "orders", authorization_required = true }
    "GET /orders/{id}"        = { integration = "orders", authorization_required = true }
  }

  jwt_authorizer = {
    issuer   = module.auth.issuer_url
    audience = [module.auth.client_id]
  }
}

module "monitoring" {
  source      = "../monitoring"
  name_prefix = "${var.project_name}-${var.environment}"
  alarm_email = var.alarm_email
  lambda_function_names = {
    products      = module.products_lambda.function_name
    cart          = module.cart_lambda.function_name
    orders        = module.orders_lambda.function_name
    inventory     = module.inventory_lambda.function_name
    notifications = module.notifications_lambda.function_name
  }
  api_id           = module.api.api_id
  queue_name       = module.order_queue.queue_name
  dlq_name         = module.order_queue.dlq_name
  pipe_name        = module.order_events.pipe_name
  event_bus_name   = module.order_events.event_bus_name
  event_rule_names = module.order_events.rule_names
  dynamodb_table_names = {
    tenants  = module.tenants_table.table_name
    products = module.products_table.table_name
    carts    = module.carts_table.table_name
    orders   = module.orders_table.table_name
  }
}

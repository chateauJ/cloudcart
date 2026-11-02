module "products_table" {
  source        = "../../modules/dynamodb"
  table_name    = "${var.project_name}-${var.environment}-products"
  hash_key_name = "productId"
}

module "products_lambda" {
  source        = "../../modules/lambda"
  function_name = "${var.project_name}-${var.environment}-products"
  dist_dir      = "${path.root}/../../../backend/dist/products"

  environment_variables = {
    PRODUCTS_TABLE_NAME = module.products_table.table_name
  }

  dynamodb_access = [
    {
      actions       = ["dynamodb:GetItem", "dynamodb:Scan"]
      resource_arns = [module.products_table.table_arn]
    }
  ]
}

module "carts_table" {
  source        = "../../modules/dynamodb"
  table_name    = "${var.project_name}-${var.environment}-carts"
  hash_key_name = "userId"
}

module "cart_lambda" {
  source        = "../../modules/lambda"
  function_name = "${var.project_name}-${var.environment}-cart"
  dist_dir      = "${path.root}/../../../backend/dist/cart"

  environment_variables = {
    CARTS_TABLE_NAME    = module.carts_table.table_name
    PRODUCTS_TABLE_NAME = module.products_table.table_name # to check a product exists before adding it
  }

  dynamodb_access = [
    {
      actions       = ["dynamodb:GetItem", "dynamodb:PutItem"]
      resource_arns = [module.carts_table.table_arn]
    },
    {
      actions       = ["dynamodb:GetItem"] # read-only: the cart never writes to products
      resource_arns = [module.products_table.table_arn]
    }
  ]
}

locals {
  orders_user_index_name = "userId-createdAt-index"
}

module "orders_table" {
  source         = "../../modules/dynamodb"
  table_name     = "${var.project_name}-${var.environment}-orders"
  hash_key_name  = "orderId"
  stream_enabled = true
  global_secondary_indexes = [
    {
      name            = local.orders_user_index_name
      hash_key        = "userId"
      hash_key_type   = "S"
      range_key       = "createdAt" # ISO-8601 strings sort chronologically
      range_key_type  = "S"
      projection_type = "ALL"
    }
  ]
}

module "orders_lambda" {
  source        = "../../modules/lambda"
  function_name = "${var.project_name}-${var.environment}-orders"
  dist_dir      = "${path.root}/../../../backend/dist/orders"
  environment_variables = {
    ORDERS_TABLE_NAME      = module.orders_table.table_name
    ORDERS_USER_INDEX_NAME = local.orders_user_index_name
    CARTS_TABLE_NAME       = module.carts_table.table_name
    PRODUCTS_TABLE_NAME    = module.products_table.table_name
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
    }
  ]
}

module "order_queue" {
  source     = "../../modules/sqs"
  queue_name = "${var.project_name}-${var.environment}-order-queue"
}

module "notifications_lambda" {
  source        = "../../modules/lambda"
  function_name = "${var.project_name}-${var.environment}-notifications"
  dist_dir      = "${path.root}/../../../backend/dist/notifications"
}

module "order_notifications_topic" {
  source             = "../../modules/sns"
  topic_name         = "${var.project_name}-${var.environment}-order-notifications"
  lambda_subscribers = { notifications = module.notifications_lambda.function_arn }
}

module "order_events" {
  source                  = "../../modules/order-events"
  name_prefix             = "${var.project_name}-${var.environment}"
  orders_stream_arn       = module.orders_table.stream_arn
  order_queue_arn         = module.order_queue.queue_arn
  order_queue_url         = module.order_queue.queue_url
  notifications_topic_arn = module.order_notifications_topic.topic_arn
}

module "inventory_lambda" {
  source        = "../../modules/lambda"
  function_name = "${var.project_name}-${var.environment}-inventory"
  dist_dir      = "${path.root}/../../../backend/dist/inventory"
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
  source                    = "../../modules/cognito"
  user_pool_name            = "${var.project_name}-${var.environment}-users"
  enable_password_auth_flow = true
  deletion_protection       = "INACTIVE"
}

module "api" {
  source             = "../../modules/api-gateway"
  api_name           = "${var.project_name}-${var.environment}-api"
  cors_allow_origins = ["http://localhost:3000"]
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
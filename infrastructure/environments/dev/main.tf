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
    "GET /cart"               = { integration = "cart" }
    "POST /cart/items"        = { integration = "cart" }
    "DELETE /cart/items/{id}" = { integration = "cart" } # {id} here is a productId
    "POST /orders"            = { integration = "orders" }
    "GET /orders"             = { integration = "orders" }
    "GET /orders/{id}"        = { integration = "orders" }
  }
}
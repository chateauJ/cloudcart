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
  }
  routes = {
    "GET /products"           = { integration = "products" }
    "GET /products/{id}"      = { integration = "products" } # {id} must match event.pathParameters.id in the handler
    "GET /cart"               = { integration = "cart" }
    "POST /cart/items"        = { integration = "cart" }
    "DELETE /cart/items/{id}" = { integration = "cart" } # {id} here is a productId
  }
}
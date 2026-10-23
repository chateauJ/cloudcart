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

module "api" {
  source             = "../../modules/api-gateway"
  api_name           = "${var.project_name}-${var.environment}-api"
  cors_allow_origins = ["http://localhost:3000"]
  integrations = {
    products = {
      function_name = module.products_lambda.function_name
      invoke_arn    = module.products_lambda.invoke_arn
    }
  }
  routes = {
    "GET /products"      = { integration = "products" }
    "GET /products/{id}" = { integration = "products" } # {id} must match event.pathParameters.id in the handler
  }
}
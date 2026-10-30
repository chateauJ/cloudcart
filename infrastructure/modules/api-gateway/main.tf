resource "aws_apigatewayv2_api" "this" {
  name          = var.api_name
  protocol_type = "HTTP"

  cors_configuration { # CORS lives on the API, not in each Lambda (spec.md §2)
    allow_origins = var.cors_allow_origins
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"] # authorization: Cognito JWT 
    max_age       = 300
  }
}

resource "aws_cloudwatch_log_group" "access_logs" {
  name              = "/aws/apigateway/${var.api_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default" # literal, not ${} interpolation - serves at the root URL
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access_logs.arn
    format = jsonencode({
      requestId               = "$context.requestId"
      sourceIp                = "$context.identity.sourceIp"
      httpMethod              = "$context.httpMethod"
      routeKey                = "$context.routeKey"
      status                  = "$context.status"
      responseLatency         = "$context.responseLatency"
      integrationErrorMessage = "$context.integrationErrorMessage" # why an integration failed, e.g. missing Lambda permission
    })
  }

  default_route_settings { # cost protection for public routes
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }
}

resource "aws_apigatewayv2_integration" "this" {
  for_each = var.integrations

  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.invoke_arn
  integration_method     = "POST" # API Gateway always invokes Lambda via POST, even for GET routes
  payload_format_version = "2.0"  # must match APIGatewayProxyEventV2 in the handlers
}

resource "aws_apigatewayv2_authorizer" "jwt" { # verifies the token before Lambda runs - bad tokens never cost an invocation
  count            = var.jwt_authorizer == null ? 0 : 1
  api_id           = aws_apigatewayv2_api.this.id
  name             = "${var.api_name}-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"] # literal $, like "$default"
  jwt_configuration {
    issuer   = var.jwt_authorizer.issuer
    audience = var.jwt_authorizer.audience
  }
}

resource "aws_apigatewayv2_route" "this" {
  for_each = var.routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.this[each.value.integration].id}"
  authorization_type = each.value.authorization_required ? "JWT" : "NONE"
  authorizer_id      = each.value.authorization_required ? aws_apigatewayv2_authorizer.jwt[0].id : null
}

resource "aws_lambda_permission" "this" { # without this: bare 500 and nothing in Lambda logs
  for_each = var.integrations

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*" # only this API may invoke
}

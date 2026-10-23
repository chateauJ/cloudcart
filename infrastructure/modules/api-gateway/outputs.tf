output "api_endpoint" {
  description = "Base invoke URL (no stage suffix thanks to the $default stage) - the frontend's API base URL later"
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "api_id" {
  description = "ID of the HTTP API - needed when attaching the Cognito JWT authorizer "
  value       = aws_apigatewayv2_api.this.id
}

output "execution_arn" {
  description = "Execution ARN of the API - used to scope Lambda invoke permissions and the authorizer later"
  value       = aws_apigatewayv2_api.this.execution_arn
}

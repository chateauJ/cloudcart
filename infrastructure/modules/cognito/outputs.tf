output "user_pool_id" {
  description = "ID of the user pool - for CLI user management and the frontend's Cognito config"
  value       = aws_cognito_user_pool.this.id
}

output "client_id" {
  description = "App client ID - the JWT authorizer's audience, and the frontend's Cognito config"
  value       = aws_cognito_user_pool_client.this.id
}

output "issuer_url" {
  description = "Token issuer URL - the JWT authorizer verifies tokens were issued by this pool"
  value       = "https://${aws_cognito_user_pool.this.endpoint}" # endpoint has no scheme; tokens' iss claim does
}

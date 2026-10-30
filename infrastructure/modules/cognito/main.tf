resource "aws_cognito_user_pool" "this" { # users sign in with email; Cognito stores and verifies passwords
  name                     = var.user_pool_name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  deletion_protection = var.deletion_protection

}

resource "aws_cognito_user_pool_client" "this" { # public SPA client - no secret, a browser can't keep one
  name                          = "${var.user_pool_name}-web"
  user_pool_id                  = aws_cognito_user_pool.this.id
  generate_secret               = false
  explicit_auth_flows           = concat(["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"], var.enable_password_auth_flow ? ["ALLOW_USER_PASSWORD_AUTH"] : [])
  prevent_user_existence_errors = "ENABLED"
  access_token_validity         = 60
  id_token_validity             = 60
  refresh_token_validity        = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

}

module "app" {
  source                      = "../../modules/app"
  project_name                = var.project_name
  environment                 = var.environment
  alarm_email                 = var.alarm_email
  lambda_dist_dir             = "${path.root}/../../../backend/dist"
  cors_allow_origins          = ["http://localhost:3000"]
  enable_password_auth_flow   = false
  cognito_deletion_protection = "ACTIVE"
}
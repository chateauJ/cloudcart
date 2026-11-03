variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "alarm_email" {
  type    = string
  default = null
}

variable "lambda_dist_dir" {
  type = string
}

variable "cors_allow_origins" {
  type = list(string)
}

variable "enable_password_auth_flow" {
  type = bool
}

variable "cognito_deletion_protection" {
  type = string
}

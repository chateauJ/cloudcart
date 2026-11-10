variable "project_name" {
  type = string
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "alarm_email" {
  type    = string
  default = null
}

variable "lambda_dist_dir" {
  type = string
}

variable "reservation_hold_minutes" {
  description = "How long a pickup order's stock is held before it goes back on sale"
  type        = number
  validation {
    condition     = var.reservation_hold_minutes >= 2
    error_message = "reservation_hold_minutes must be at least 2: the expiry schedule is created at least a minute ahead."
  }
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

variable "storefront_tenant_id" {
  type    = string
  default = "northlight" # which seeded business the hosted storefront is built for
}

variable "user_pool_name" {
  type = string
}

variable "enable_password_auth_flow" {
  type    = bool
  default = false
}

variable "deletion_protection" {
  type    = string
  default = "ACTIVE"
  validation {
    condition     = contains(["ACTIVE", "INACTIVE"], var.deletion_protection)
    error_message = "Deletion_protection must be ACTIVE or INACTIVE for AWS to delete pool."
  }
}

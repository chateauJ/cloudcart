variable "aws_region" {
  description = "AWS region for the CloudCart project"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name, prefix for resouce names"
  type        = string
  default     = "cloudcart"
}

variable "environment" {
  description = "Environment only allows prod or dev environment using a validation block"
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be dev or prod."
  }
}
variable "alarm_email" {
  type    = string
  default = null
}

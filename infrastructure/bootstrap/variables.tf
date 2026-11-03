variable "aws_region" {
  description = "AWS region for the CloudCart project"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name, used as a prefix for resource names"
  type        = string
  default     = "cloudcart"
}

variable "github_repository" {
  type    = string
  default = "chateauJ/cloudcart"
}

variable "environments" {
  type    = list(string)
  default = ["dev", "prod"]
}

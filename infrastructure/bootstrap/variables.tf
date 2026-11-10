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
  default = "chateauJ@102707406/cloudcart@1368975523"
}

variable "environments" {
  type    = list(string)
  default = ["dev", "prod"]
}

variable "alarm_email" {
  description = "Where budget alerts are emailed - set in the gitignored local.auto.tfvars, never committed"
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly account spend that triggers the budget alerts"
  type        = number
  default     = 10
}

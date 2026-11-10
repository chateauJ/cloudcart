variable "function_name" {
  description = "Fully resolved function name, e.g. cloudcart-dev-products"
  type        = string
}

variable "dist_dir" {
  description = "Path to the esbuild output directory containing index.js for this function"
  type        = string
}

variable "handler" {
  description = "Must match esbuild's --outfile basename and the exported function name"
  type        = string
  default     = "index.handler"
}

variable "runtime" {
  type    = string
  default = "nodejs24.x"
}

variable "architecture" {
  type    = string
  default = "arm64"
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout" {
  description = "Seconds"
  type        = number
  default     = 10
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "dynamodb_access" {
  description = "One entry per group of DynamoDB actions this function needs, and the table/index ARNs those actions apply to"
  type = list(object({
    actions       = list(string)
    resource_arns = list(string)
  }))
  default = []
}

variable "extra_policy_statements" {
  description = "Further IAM policy statements (Sid, Effect, Action, Resource, optional Condition) for services the variables above don't cover"
  type        = any # statements differ in shape (some have a Condition), which no single object type allows
  default     = []
}

variable "sqs_event_source" {
  type    = object({ queue_arn = string, batch_size = optional(number, 5) })
  default = null
}

variable "log_level" {
  type    = string
  default = "INFO"
  validation {
    condition     = contains(["DEBUG", "INFO", "WARN", "ERROR"], var.log_level)
    error_message = "log_level must be one of DEBUG, INFO, WARN, ERROR."
  }
}

variable "permissions_boundary_arn" {
  type    = string
  default = null
}

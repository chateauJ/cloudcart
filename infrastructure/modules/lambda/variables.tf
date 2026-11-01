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
  default = "nodejs20.x"
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

variable "sqs_event_source" {
  type    = object({ queue_arn = string, batch_size = optional(number, 5) })
  default = null
}

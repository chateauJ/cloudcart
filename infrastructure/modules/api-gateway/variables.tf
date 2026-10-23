variable "api_name" {
  type = string
}

variable "cors_allow_origins" {
  type = list(string)
}

variable "integrations" {
  type = map(object({
    function_name = string,
    invoke_arn    = string
  }))
}

variable "routes" {
  type = map(object({
    integration = string
  }))
}

variable "throttling_rate_limit" {
  type    = number
  default = 20
}

variable "throttling_burst_limit" {
  type    = number
  default = 50
}

variable "log_retention_days" {
  type    = number
  default = 14
}

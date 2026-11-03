variable "name_prefix" {
  type = string
}

variable "alarm_email" {
  type    = string
  default = null
}

variable "lambda_function_names" {
  type = map(string)
}

variable "api_id" {
  type = string
}

variable "api_4xx_rate_threshold_percent" {
  type    = number
  default = 25
}

variable "api_p99_latency_threshold_ms" {
  type    = number
  default = 2000
}

variable "queue_name" {
  type = string
}

variable "dlq_name" {
  type = string
}

variable "queue_backlog_threshold" {
  type    = number
  default = 100
}

variable "queue_oldest_message_age_threshold_seconds" {
  type    = number
  default = 300
}

variable "pipe_name" {
  type = string
}

variable "event_bus_name" {
  type = string
}

variable "event_rule_names" {
  type = map(string)
}

variable "dynamodb_table_names" {
  type = map(string)
}

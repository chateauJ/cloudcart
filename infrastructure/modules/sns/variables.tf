variable "topic_name" {
  type = string
}

variable "lambda_subscribers" {
  type    = map(string)
  default = {}
}

variable "table_name" {
  type = string
}

variable "hash_key_name" {
  type = string
}

variable "hash_key_type" {
  type    = string
  default = "S"
}

variable "range_key_name" {
  type    = string
  default = null
}

variable "range_key_type" {
  type    = string
  default = null
}

variable "billing_mode" {
  type    = string
  default = "PAY_PER_REQUEST"
}

variable "stream_enabled" {
  type    = bool
  default = false
}

variable "stream_view_type" {
  type    = string
  default = "NEW_IMAGE"
}

variable "global_secondary_indexes" {
  type = list(object({
    name            = string
    hash_key        = string
    hash_key_type   = string
    range_key       = optional(string)
    range_key_type  = optional(string)
    projection_type = string
  }))
  default = []
}
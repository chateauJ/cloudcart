variable "name_prefix" {
  type = string
}

variable "price_class" {
  type    = string
  default = "PriceClass_100" # North America and Europe edge locations only - the cheapest class
}

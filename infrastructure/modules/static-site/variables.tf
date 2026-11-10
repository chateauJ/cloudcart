variable "name_prefix" {
  type = string
}

variable "price_class" {
  type    = string
  default = "PriceClass_100" # North America and Europe edge locations only - the cheapest class
}

variable "api_domain" {
  description = "Host name of the HTTP API's default endpoint - the origin behind /api/*"
  type        = string
}

variable "catalog_ttl_seconds" {
  description = "How long the edge may serve a cached catalog response (GET /tenant, /locations, /products, /products/{id})"
  type        = number
  default     = 30
}

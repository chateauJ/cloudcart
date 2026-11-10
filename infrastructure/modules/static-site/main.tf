data "aws_caller_identity" "current" {}

# AWS-managed policies, looked up by name: long-lived caching that honours the origin's
# Cache-Control, and standard security headers (HSTS, nosniff, frame options, referrer policy)
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

# Forwards every viewer header except Host, which must stay the API's own domain for API Gateway to route the request
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# Public catalog reads (store, locations, products with stock), cached briefly at the edge. X-Tenant-Id is in the cache key, so each store's
# catalog is cached separately - without it, the first store's products would be served to every store.
# No query strings or cookies in the key: the catalog routes take none, and random ones can't bust the cache.
# max_ttl caps the TTL too, so a Cache-Control header from the origin can't keep stock levels stale for longer.
resource "aws_cloudfront_cache_policy" "catalog" {
  name        = "${var.name_prefix}-api-catalog"
  comment     = "Public catalog routes, cached per tenant"
  min_ttl     = 0
  default_ttl = var.catalog_ttl_seconds
  max_ttl     = var.catalog_ttl_seconds

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["X-Tenant-Id"]
      }
    }
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# Every other API route: never cached. This isn't the managed CachingDisabled policy because CloudFront
# strips Authorization from GET requests unless it's in the cache key - GET /cart would reach the JWT
# authorizer without a token. So the key includes it, and the TTLs stay at zero (max_ttl 1 is the
# smallest that allows a cache key at all). The API sends no Cache-Control, so default_ttl 0 applies.
resource "aws_cloudfront_cache_policy" "api_no_cache" {
  name        = "${var.name_prefix}-api-no-cache"
  comment     = "Signed-in API routes, never cached; forwards Authorization"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 1

  parameters_in_cache_key_and_forwarded_to_origin {
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Authorization", "X-Tenant-Id"]
      }
    }
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

resource "aws_s3_bucket" "site" {                                                          # private - only this distribution can read it, through OAC
  bucket        = "${var.name_prefix}-site-${data.aws_caller_identity.current.account_id}" # bucket names are global, so the account ID keeps it unique
  force_destroy = true                                                                     # holds only build output, which every deploy re-uploads
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced" # disables ACLs - access is decided by the bucket policy alone
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "site" { # CloudFront signs its S3 requests, so the bucket never needs to be public
  name                              = "${var.name_prefix}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "url_rewrite" {
  name    = "${var.name_prefix}-url-rewrite"
  comment = "Maps page URLs onto the static export's index.html files"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/url-rewrite.js")
}

resource "aws_cloudfront_function" "api_prefix" {
  name    = "${var.name_prefix}-api-prefix"
  comment = "Strips /api so requests match the HTTP API's routes"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/api-prefix.js")
}

locals {
  # The storefront and its API share this one origin, so the hosted site needs no CORS.
  # Behaviours are matched in order: the cached catalog paths first, then everything else under /api/.
  api_behaviors = [
    { path = "/api/tenant", cache_policy_id = aws_cloudfront_cache_policy.catalog.id, origin_request_policy_id = null },
    { path = "/api/locations", cache_policy_id = aws_cloudfront_cache_policy.catalog.id, origin_request_policy_id = null },
    { path = "/api/products*", cache_policy_id = aws_cloudfront_cache_policy.catalog.id, origin_request_policy_id = null },
    { path = "/api/*", cache_policy_id = aws_cloudfront_cache_policy.api_no_cache.id, origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id },
  ]
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "${var.name_prefix} storefront"
  default_root_object = "index.html"
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = var.price_class

  origin {
    origin_id                = "site-bucket"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id   = "api"
    domain_name = var.api_domain

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only" # API Gateway serves HTTPS only
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.api_behaviors
    content {
      path_pattern               = ordered_cache_behavior.value.path
      target_origin_id           = "api"
      viewer_protocol_policy     = "https-only" # a redirect would turn a POST into a GET
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = ordered_cache_behavior.value.cache_policy_id
      origin_request_policy_id   = ordered_cache_behavior.value.origin_request_policy_id
      response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.api_prefix.arn
      }
    }
  }

  default_cache_behavior {
    target_origin_id           = "site-bucket"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"] # a static site takes no writes
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.url_rewrite.arn
    }
  }

  # Without s3:ListBucket, S3 answers a missing key with 403 rather than 404, so 403 becomes the site's 404 page.
  # Error pages apply to every behaviour, /api/* included, so 404 is deliberately not mapped: the API's own
  # 404s (PRODUCT_NOT_FOUND, ORDER_NOT_FOUND, ...) must reach the client as JSON. For the same reason the API
  # never answers 403 - its authorizer rejects with 401, and handlers hide what a caller can't see behind a 404.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true # the free *.cloudfront.net certificate - a custom domain is out of scope
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ReadByThisDistributionOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.site.arn}/*"
        Condition = {
          StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } # not any CloudFront distribution - this one
        }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.site]
}

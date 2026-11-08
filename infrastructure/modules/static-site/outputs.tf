output "bucket_name" {
  description = "Site bucket - the deploy job syncs the frontend's out/ folder here"
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "CloudFront distribution ID - the deploy job invalidates its cache after each upload"
  value       = aws_cloudfront_distribution.site.id
}

output "url" {
  description = "Public HTTPS URL of the storefront"
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "state_bucket_name" {
  description = "S3 bucket holding Terraform state - paste into each environment's backend.tf"
  value       = aws_s3_bucket.terraform_state.bucket
}

output "lock_table_name" {
  description = "DynamoDB table used for Terraform state locking - paste into each environment's backend.tf"
  value       = aws_dynamodb_table.terraform_lock.name
}

output "aws_region" {
  description = "Region the backend resources were created in"
  value       = var.aws_region
}

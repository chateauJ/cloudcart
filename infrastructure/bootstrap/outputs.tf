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

output "github_actions_role_arn" {
  description = "Role GitHub Actions assumes via OIDC - set as the AWS_ROLE_ARN repository variable"
  value       = aws_iam_role.github_actions.arn
}

output "workload_boundary_arn" {
  description = "Permissions boundary every app role must carry"
  value       = aws_iam_policy.workload_boundary.arn
}

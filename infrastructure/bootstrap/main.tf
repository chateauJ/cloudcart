data "aws_caller_identity" "current" {}

# S3 bucket names are globally unique across all AWS accounts, so the account
# id is appended to guarantee this name is free without guessing/coordinating
# one by hand.
locals {
  state_bucket_name = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"
  lock_table_name   = "${var.project_name}-tfstate-lock"
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = local.state_bucket_name

  # Terraform state holds resource IDs and (sometimes) sensitive attribute
  # values. Destroying this bucket by accident would take every environment's
  # state with it, so refuse to let `terraform destroy` touch it.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    # Every state write creates a new version, so a bad `apply` or corrupted
    # state file can be rolled back from S3 version history.
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "terraform_lock" {
  name         = local.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }
}

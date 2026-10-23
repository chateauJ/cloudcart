terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # No backend block here on purpose - this root module creates the state
  # backend that every other root module will use, so it can't depend on
  # it. Its own state stays local. See README in this directory.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Layer     = "bootstrap"
    }
  }
}

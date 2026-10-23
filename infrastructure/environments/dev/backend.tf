terraform {
  backend "s3" {
    bucket         = "cloudcart-tfstate-202343499816"
    key            = "environments/dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cloudcart-tfstate-lock"
    encrypt        = true
  }
}
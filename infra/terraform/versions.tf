terraform {
  required_version = ">= 1.6"

  # State lives in a versioned bucket created by hand (a state bucket cannot create itself).
  backend "s3" {
    bucket  = "jobapp-tfstate-016170038537"
    key     = "prod/terraform.tfstate"
    region  = "us-east-2"
    encrypt = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# Every resource lives in the single region the AWS project is locked to.
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      app        = var.name
      env        = "prod"
      managed_by = "terraform"
    }
  }
}

terraform {
  required_version = ">= 1.6"

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

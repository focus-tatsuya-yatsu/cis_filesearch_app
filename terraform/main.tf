# CIS File Search Application - Main Terraform Configuration
# Pattern 3: Monthly Batch Synchronization Architecture

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "cis-filesearch-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "ap-northeast-1"
    encrypt        = true
    dynamodb_table = "cis-filesearch-terraform-lock"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "CIS-FileSearch"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Pattern     = "MonthlyBatch"
    }
  }
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# AxiomV2 infrastructure — Phase 1: memory (DynamoDB + S3 Vectors), scale-to-zero.
# Everything is prefixed atlasv2- and tagged; later phases (API GW + Lambda) land here too.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.24"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project     = "atlasv2"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}

data "aws_caller_identity" "current" {}

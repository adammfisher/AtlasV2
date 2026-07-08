# ============================================================================
# Serverless app platform (PRD §12.1) — scale-to-zero.
#
# atlasv2-app: single-table DynamoDB for ALL app data (was SQLite).
#   Entities by pk/sk:  SETTINGS/<key> · PROJECTS/<id> · CONV/<id> ·
#   MSG#<conv>/<created_at>#<id> · ART/<id> · ARTV#<art>/<version> ·
#   SKILLS/<id> · PLUGINS/<id> · PROD#<art>/<n> · PROJN#<art>/<id> ·
#   KNOW#<project>/<id> · PENDING/<convId>
#
# atlasv2-artifacts: generated documents (versions live under
#   <projectId>/<artifactId>/v<N>/...).
#
# ECR + Lambda exec role for the container deployment (Lambda Web Adapter).
# ============================================================================

resource "aws_dynamodb_table" "app" {
  name         = "${var.project_name}-app"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "pk"
  range_key = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "${var.project_name}-artifacts-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_ecr_repository" "app" {
  name                 = "${var.project_name}-app"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_iam_role" "lambda" {
  name = "${var.project_name}-lambda-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_app" {
  name = "${var.project_name}-lambda-app"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchWriteItem"]
        Resource = [
          aws_dynamodb_table.app.arn,
          "${aws_dynamodb_table.app.arn}/index/*",
          aws_dynamodb_table.memory.arn,
          "${aws_dynamodb_table.memory.arn}/index/*",
        ]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [
          aws_s3_bucket.artifacts.arn,
          "${aws_s3_bucket.artifacts.arn}/*",
          aws_s3_bucket.uploads.arn,
          "${aws_s3_bucket.uploads.arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:ListFoundationModels"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = ["s3vectors:*"]
        Resource = "arn:aws:s3vectors:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"
      },
    ]
  })
}

output "app_table_name" {
  value = aws_dynamodb_table.app.name
}
output "artifacts_bucket_name" {
  value = aws_s3_bucket.artifacts.bucket
}
output "ecr_repo_url" {
  value = aws_ecr_repository.app.repository_url
}

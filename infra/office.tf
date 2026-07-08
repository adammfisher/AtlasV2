# atlasv2-office: scale-to-zero Python office builder (PRD §12.1). The main app
# Lambda invokes it for pptx/docx/xlsx/pdf; idle cost is nil. Package (deps +
# build_*.py + templates) is uploaded to S3 out-of-band by the deploy script.

variable "office_zip_s3_key" {
  type    = string
  default = "lambda/office.zip"
}
variable "office_source_hash" {
  description = "sha of the uploaded office.zip (deploy script sets this to force updates)"
  type        = string
  default     = ""
}

resource "aws_lambda_function" "office" {
  function_name = "${var.project_name}-office"
  role          = aws_iam_role.lambda.arn
  s3_bucket     = aws_s3_bucket.artifacts.bucket
  s3_key        = var.office_zip_s3_key
  handler       = "lambda_handler.handler"
  runtime       = "python3.12"
  architectures = ["arm64"]
  timeout       = 180
  memory_size   = 1024
  source_code_hash = var.office_source_hash != "" ? var.office_source_hash : null
}

# let the main app Lambda invoke the office builder
resource "aws_iam_role_policy" "invoke_office" {
  name = "${var.project_name}-invoke-office"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.office.arn
    }]
  })
}

output "office_function_name" {
  value = aws_lambda_function.office.function_name
}

# Serverless compute (PRD §12.1 stage 34): container Lambda behind a STREAMING
# Function URL (SSE chat), EventBridge schedules replacing in-process timers,
# client on S3 + CloudFront with /api/* routed to the Lambda.

resource "aws_lambda_function" "app" {
  function_name    = "${var.project_name}-app"
  role             = aws_iam_role.lambda.arn
  filename         = "${path.module}/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda.zip")
  handler          = "run.sh"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  # 900s is the Lambda maximum. Generation no longer imposes a token ceiling, so
  # a large artifact (a multi-screen React app) can legitimately stream for
  # minutes; at the previous 300s the function, not the model, was what decided
  # how long a document could get. This is now the real upper bound on the
  # deployed app — a request that needs longer than 15 minutes cannot be served
  # by Lambda at any setting.
  timeout          = 900
  memory_size      = 1536
  layers           = ["arn:aws:lambda:us-east-1:753240598075:layer:LambdaAdapterLayerArm64:25"]

  environment {
    variables = {
      AWS_LAMBDA_EXEC_WRAPPER = "/opt/bootstrap"
      AWS_LWA_INVOKE_MODE     = "response_stream"
      PORT                    = "8080"
    }
  }
}

resource "aws_lambda_function_url" "app" {
  function_name      = aws_lambda_function.app.function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"
}

# EventBridge → same Lambda with HTTP-shaped payloads (LWA translates them)
resource "aws_cloudwatch_event_rule" "sweep" {
  name                = "${var.project_name}-memory-sweep"
  schedule_expression = "rate(1 minute)"
}
resource "aws_cloudwatch_event_rule" "consolidate" {
  name                = "${var.project_name}-memory-consolidate"
  schedule_expression = "rate(6 hours)"
}

locals {
  sweep_payload = jsonencode({
    version = "2.0", routeKey = "$default", rawPath = "/api/internal/sweep",
    headers = { "content-type" = "application/json" }, body = "{}",
    requestContext = { http = { method = "POST", path = "/api/internal/sweep", sourceIp = "eventbridge", protocol = "HTTP/1.1" } }
    isBase64Encoded = false
  })
  consolidate_payload = jsonencode({
    version = "2.0", routeKey = "$default", rawPath = "/api/internal/consolidate",
    headers = { "content-type" = "application/json" }, body = "{}",
    requestContext = { http = { method = "POST", path = "/api/internal/consolidate", sourceIp = "eventbridge", protocol = "HTTP/1.1" } }
    isBase64Encoded = false
  })
}

resource "aws_cloudwatch_event_target" "sweep" {
  rule  = aws_cloudwatch_event_rule.sweep.name
  arn   = aws_lambda_function.app.arn
  input = local.sweep_payload
}
resource "aws_cloudwatch_event_target" "consolidate" {
  rule  = aws_cloudwatch_event_rule.consolidate.name
  arn   = aws_lambda_function.app.arn
  input = local.consolidate_payload
}
resource "aws_lambda_permission" "sweep" {
  statement_id  = "AllowSweep"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sweep.arn
}
resource "aws_lambda_permission" "consolidate" {
  statement_id  = "AllowConsolidate"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.consolidate.arn
}

# ── client hosting: S3 (private, OAC) + CloudFront; /api/* → Function URL ──
resource "aws_s3_bucket" "client" {
  bucket = "${var.project_name}-client-${data.aws_caller_identity.current.account_id}"
}
resource "aws_s3_bucket_public_access_block" "client" {
  bucket                  = aws_s3_bucket.client.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "client" {
  name                              = "${var.project_name}-client-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

locals {
  furl_domain = replace(replace(aws_lambda_function_url.app.function_url, "https://", ""), "/", "")
}

resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    origin_id                = "client-s3"
    domain_name              = aws_s3_bucket.client.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.client.id
  }
  origin {
    origin_id   = "api-lambda"
    domain_name = local.furl_domain
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 120
    }
  }

  default_cache_behavior {
    target_origin_id       = "client-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api-lambda"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewerExceptHostHeader
  }

  custom_error_response { # SPA fallback
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "client" {
  bucket = aws_s3_bucket.client.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.client.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.app.arn } }
    }]
  })
}

output "function_url" {
  value = aws_lambda_function_url.app.function_url
}
output "cloudfront_domain" {
  value = aws_cloudfront_distribution.app.domain_name
}

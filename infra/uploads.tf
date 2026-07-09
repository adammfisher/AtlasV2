# Chat attachments — uploaded files mirror to S3 so they're durable and can be
# pulled back down from the conversation (hover-download on the file chip).
# Private, encrypted, no public access; keys are uploads/<attachment-id>.

resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project_name}-uploads-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "uploads_bucket_name" {
  value = aws_s3_bucket.uploads.bucket
}

# browser presigned-PUT uploads (large files bypass the 6MB Lambda request cap)
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = "atlasv2-uploads-683032473658"
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = ["https://d3jokv6laueeqx.cloudfront.net", "http://localhost:5173", "http://127.0.0.1:5173"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

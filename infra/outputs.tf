output "memory_table_name" {
  description = "DynamoDB memory table"
  value       = aws_dynamodb_table.memory.name
}

output "memory_table_arn" {
  value = aws_dynamodb_table.memory.arn
}

output "vectors_bucket_name" {
  description = "S3 Vectors bucket for semantic memory"
  value       = aws_s3vectors_vector_bucket.memory_vectors.vector_bucket_name
}

output "vectors_bucket_arn" {
  value = aws_s3vectors_vector_bucket.memory_vectors.vector_bucket_arn
}

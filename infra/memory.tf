# ============================================================================
# AxiomV2 Memory — Documentation/MEMORY_DESIGN.md §4
#
# Single-table DynamoDB design (on-demand → scale-to-zero):
#   Profile fact   PK=S#u#<user>|S#p#<project>   SK=KV#<category>.<key>
#   Note metadata  PK=S#…                        SK=NOTE#<factId>
#   Entity         PK=S#…                        SK=ENT#<name>
#   Edge (forward) PK=S#…#E#<src>                SK=EDGE#<rel>#<dst>
#
# GSI1 stores the reverse edge (gsi1pk=S#…#E#<dst>, gsi1sk=EDGE#<rel>#<src>)
# giving true two-way entity adjacency: outbound = query PK, inbound = query GSI1.
#
# S3 Vectors bucket holds the semantic indexes (user-mem, proj-<id>-mem);
# indexes are created programmatically by the server (per-project isolation),
# following v1's proven pattern. Titan v2 embeddings, 1024-dim cosine.
# ============================================================================

resource "aws_dynamodb_table" "memory" {
  name         = "${var.project_name}-memory"
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
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  # Phase 3 decay: low-importance notes get an expiry epoch; recall refreshes it.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_s3vectors_vector_bucket" "memory_vectors" {
  vector_bucket_name = "${var.project_name}-memory-vectors"
}

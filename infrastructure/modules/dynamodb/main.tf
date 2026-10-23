locals {
  key_attributes = distinct(concat(
    [{ name = var.hash_key_name, type = var.hash_key_type }],
    var.range_key_name != null ? [{ name = var.range_key_name, type = var.range_key_type }] : [],
    flatten([
      for gsi in var.global_secondary_indexes : concat(
        [{ name = gsi.hash_key, type = gsi.hash_key_type }],
        gsi.range_key != null ? [{ name = gsi.range_key, type = gsi.range_key_type }] : []
      )
    ])
  ))
}

resource "aws_dynamodb_table" "this" {
  name             = var.table_name
  billing_mode     = var.billing_mode
  hash_key         = var.hash_key_name
  range_key        = var.range_key_name
  stream_enabled   = var.stream_enabled
  stream_view_type = var.stream_enabled ? var.stream_view_type : null

  dynamic "attribute" {
    for_each = local.key_attributes
    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  dynamic "global_secondary_index" {
    for_each = var.global_secondary_indexes
    content {
      name            = global_secondary_index.value.name
      hash_key        = global_secondary_index.value.hash_key
      range_key       = global_secondary_index.value.range_key
      projection_type = global_secondary_index.value.projection_type
    }
  }
}
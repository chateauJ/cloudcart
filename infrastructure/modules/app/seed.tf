locals {
  # tenants.json and products.json are the seed data's single source. Products are keyed
  # "<tenantId>/<productId>" because product IDs repeat across tenants.
  tenants  = { for t in jsondecode(file("${path.module}/tenants.json")) : t.tenantId => t }
  products = { for p in jsondecode(file("${path.module}/products.json")) : "${p.tenantId}/${p.productId}" => p }
}

resource "aws_dynamodb_table_item" "tenant" {
  for_each   = local.tenants
  table_name = module.tenants_table.table_name
  hash_key   = "tenantId"

  lifecycle {
    ignore_changes = [item] # seed once, like the products: later edits happen in the table
  }

  item = jsonencode({
    tenantId = { S = each.key }
    name     = { S = each.value.name }
    tagline  = { S = each.value.tagline }
  })
}

resource "aws_dynamodb_table_item" "product" {
  for_each   = local.products
  table_name = module.products_table.table_name
  hash_key   = "tenantId"
  range_key  = "productId"

  lifecycle {
    ignore_changes = [item] # seed once: orders decrement inventory at runtime, and a re-apply would reset it

    precondition {
      condition     = contains(keys(local.tenants), each.value.tenantId)
      error_message = "products.json has a product for tenant \"${each.value.tenantId}\", which isn't in tenants.json."
    }
  }

  item = jsonencode({
    tenantId    = { S = each.value.tenantId }
    productId   = { S = each.value.productId }
    name        = { S = each.value.name }
    description = { S = each.value.description }
    price       = { N = tostring(each.value.price) } # DynamoDB's N type is a string in item JSON
    inventory   = { N = tostring(each.value.inventory) }
    category    = { S = each.value.category }
  })
}

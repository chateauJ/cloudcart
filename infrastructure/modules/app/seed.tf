locals {
  # tenants.json, locations.json and products.json are the seed data's single source. Keys are
  # prefixed "<tenantId>/" because product and location IDs repeat across tenants.
  tenants   = { for t in jsondecode(file("${path.module}/tenants.json")) : t.tenantId => t }
  locations = { for l in jsondecode(file("${path.module}/locations.json")) : "${l.tenantId}/${l.locationId}" => l }
  products  = { for p in jsondecode(file("${path.module}/products.json")) : "${p.tenantId}/${p.productId}" => p }

  # Each product's "stock" map (locationId => quantity) becomes one stock item per location
  stock = merge([
    for key, p in local.products : {
      for locationId, quantity in p.stock : "${key}/${locationId}" => {
        tenantId   = p.tenantId
        productId  = p.productId
        locationId = locationId
        quantity   = quantity
      }
    }
  ]...)
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
    ignore_changes = [item] # seed once: later edits happen in the table

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
    category    = { S = each.value.category }
  })
}

resource "aws_dynamodb_table_item" "location" {
  for_each   = local.locations
  table_name = module.locations_table.table_name
  hash_key   = "tenantId"
  range_key  = "locationId"

  lifecycle {
    ignore_changes = [item]

    precondition {
      condition     = contains(keys(local.tenants), each.value.tenantId)
      error_message = "locations.json has a location for tenant \"${each.value.tenantId}\", which isn't in tenants.json."
    }
  }

  item = jsonencode({
    tenantId      = { S = each.value.tenantId }
    locationId    = { S = each.value.locationId }
    name          = { S = each.value.name }
    type          = { S = each.value.type }
    pickupEnabled = { BOOL = each.value.pickupEnabled }
  })
}

resource "aws_dynamodb_table_item" "stock" {
  for_each   = local.stock
  table_name = module.stock_table.table_name
  hash_key   = "tenantId"
  range_key  = "stockKey"

  lifecycle {
    ignore_changes = [item] # seed once: orders decrement stock at runtime, and a re-apply would reset it

    precondition {
      condition     = contains(keys(local.locations), "${each.value.tenantId}/${each.value.locationId}")
      error_message = "products.json stocks ${each.value.productId} at \"${each.value.locationId}\", which isn't one of tenant ${each.value.tenantId}'s locations in locations.json."
    }
  }

  item = jsonencode({
    tenantId   = { S = each.value.tenantId }
    stockKey   = { S = "${each.value.productId}#${each.value.locationId}" }
    productId  = { S = each.value.productId }
    locationId = { S = each.value.locationId }
    quantity   = { N = tostring(each.value.quantity) }
  })
}

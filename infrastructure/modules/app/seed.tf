locals {
  # products.json is the catalog's single source; keying by productId keeps each item's address
  # stable when products are added or reordered
  products = { for p in jsondecode(file("${path.module}/products.json")) : p.productId => p }
}

resource "aws_dynamodb_table_item" "product" {
  for_each   = local.products
  table_name = module.products_table.table_name
  hash_key   = "productId"

  lifecycle {
    ignore_changes = [item] # seed once: orders decrement inventory at runtime, and a re-apply would reset it
  }

  item = jsonencode({
    productId   = { S = each.key }
    name        = { S = each.value.name }
    description = { S = each.value.description }
    price       = { N = tostring(each.value.price) } # DynamoDB's N type is a string in item JSON
    inventory   = { N = tostring(each.value.inventory) }
    category    = { S = each.value.category }
  })
}

# The first three products were individual resources; these keep them instead of recreating them
moved {
  from = aws_dynamodb_table_item.prod_004
  to   = aws_dynamodb_table_item.product["prod_004"]
}

moved {
  from = aws_dynamodb_table_item.prod_010
  to   = aws_dynamodb_table_item.product["prod_010"]
}

moved {
  from = aws_dynamodb_table_item.prod_005
  to   = aws_dynamodb_table_item.product["prod_005"]
}

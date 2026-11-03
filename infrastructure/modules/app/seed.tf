resource "aws_dynamodb_table_item" "prod_004" {
  table_name = module.products_table.table_name
  hash_key   = "productId"

  lifecycle {
    ignore_changes = [item]
  }

  item = jsonencode({
    productId   = { S = "prod_004" }
    name        = { S = "Vantage Point Action Camera" }
    description = { S = "Waterproof to 33ft, 5.3K video, built-in image stabilization." }
    price       = { N = "329.99" }
    inventory   = { N = "40" }
    category    = { S = "cameras" }
  })
}

resource "aws_dynamodb_table_item" "prod_010" {
  table_name = module.products_table.table_name
  hash_key   = "productId"

  lifecycle {
    ignore_changes = [item]
  }

  item = jsonencode({
    productId   = { S = "prod_010" }
    name        = { S = "FastCharge 65W GaN Wall Charger" }
    description = { S = "Compact dual-port USB-C charger, fast-charges phone and laptop." }
    price       = { N = "39.99" }
    inventory   = { N = "95" }
    category    = { S = "phone-accessories" }
  })
}

resource "aws_dynamodb_table_item" "prod_005" {
  table_name = module.products_table.table_name
  hash_key   = "productId"

  lifecycle {
    ignore_changes = [item]
  }

  item = jsonencode({
    productId   = { S = "prod_005" }
    name        = { S = "Steadicam Mini Gimbal" }
    description = { S = "3-axis handheld gimbal stabilizer for mirrorless cameras." }
    price       = { N = "189" }
    inventory   = { N = "30" }
    category    = { S = "cameras" }
  })
}

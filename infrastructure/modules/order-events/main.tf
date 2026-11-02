resource "aws_cloudwatch_event_bus" "this" { # custom bus keeps app events separate from AWS's default bus
  name = "${var.name_prefix}-events"
}

resource "aws_iam_role" "pipe" {
  name = "${var.name_prefix}-orders-pipe-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "pipes.amazonaws.com" } # the Pipes service assumes this role, not Lambda
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "pipe" {
  name = "${var.name_prefix}-orders-pipe-policy"
  role = aws_iam_role.pipe.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"]
        Resource = var.orders_stream_arn
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:ListStreams"]
        Resource = "*" # ListStreams doesn't support resource-level permissions
      },
      {
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.this.arn
      },
    ]
  })
}

resource "aws_pipes_pipe" "orders" { # stream -> bus with no code: OrderCreated fires iff the order write committed (spec.md §4)
  name     = "${var.name_prefix}-orders-pipe"
  role_arn = aws_iam_role.pipe.arn
  source   = var.orders_stream_arn
  target   = aws_cloudwatch_event_bus.this.arn

  source_parameters {
    dynamodb_stream_parameters {
      starting_position = "LATEST" # TRIM_HORIZON would replay the last 24h of test orders
      batch_size        = 10       # PutEvents accepts at most 10 entries per call
    }

    filter_criteria {
      filter {
        pattern = jsonencode({ eventName = ["INSERT"] }) # new orders only - status updates arrive as MODIFY
      }
    }
  }

  target_parameters {
    eventbridge_event_bus_parameters {
      source      = "cloudcart.orders"
      detail_type = "OrderCreated"
    }

    # Becomes the event's detail. Heredoc, not jsonencode: it's only valid JSON after
    # Pipes fills the <$.path> placeholders. total stays a string: DynamoDB's N is a string
    # in stream records, and Pipes quotes string values even when the template doesn't.
    input_template = <<-EOT
      {
        "orderId": "<$.dynamodb.NewImage.orderId.S>",
        "userId": "<$.dynamodb.NewImage.userId.S>",
        "total": "<$.dynamodb.NewImage.total.N>",
        "createdAt": "<$.dynamodb.NewImage.createdAt.S>"
      }
    EOT
  }

  depends_on = [aws_iam_role_policy.pipe] # Pipes validates permissions at creation
}

resource "aws_cloudwatch_event_rule" "order_created" { # matches source + detail-type, the routing contract
  name           = "${var.name_prefix}-order-created"
  event_bus_name = aws_cloudwatch_event_bus.this.name

  event_pattern = jsonencode({
    source        = ["cloudcart.orders"]
    "detail-type" = ["OrderCreated"]
  })
}

resource "aws_cloudwatch_event_target" "order_queue" {
  rule           = aws_cloudwatch_event_rule.order_created.name
  event_bus_name = aws_cloudwatch_event_bus.this.name # omit it and Terraform looks for the rule on the default bus
  target_id      = "order-queue"
  arn            = var.order_queue_arn
}

resource "aws_sqs_queue_policy" "order_queue" { # resource-based policy: only this rule may send to the queue
  queue_url = var.order_queue_url

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = var.order_queue_arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.order_created.arn }
      }
    }]
  })
}

resource "aws_cloudwatch_event_rule" "order_created_notifications" { # one rule per consumer, so each can change its filter independently
  name           = "${var.name_prefix}-order-created-notifications"
  event_bus_name = aws_cloudwatch_event_bus.this.name

  event_pattern = jsonencode({
    source        = ["cloudcart.orders"]
    "detail-type" = ["OrderCreated"]
  })
}

resource "aws_cloudwatch_event_target" "notifications_topic" {
  rule           = aws_cloudwatch_event_rule.order_created_notifications.name
  event_bus_name = aws_cloudwatch_event_bus.this.name
  target_id      = "notifications-topic"
  arn            = var.notifications_topic_arn
}

resource "aws_sns_topic_policy" "notifications" { # replaces the topic's whole policy - keep it the only one for this topic
  arn = var.notifications_topic_arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = var.notifications_topic_arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.order_created_notifications.arn }
      }
    }]
  })
}

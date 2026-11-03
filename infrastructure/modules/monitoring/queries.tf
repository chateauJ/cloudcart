locals {
  log_group_names = [for name in values(var.lambda_function_names) : "/aws/lambda/${name}"]
}

resource "aws_cloudwatch_query_definition" "errors" {
  name            = "${var.name_prefix}/errors"
  log_group_names = local.log_group_names
  query_string    = <<-EOT
    fields @timestamp, function, message, error.message
    | filter level = "ERROR"
    | sort @timestamp desc
    | limit 50
  EOT
}

resource "aws_cloudwatch_query_definition" "order_timeline" { # one orderId across three functions - what the shared log fields buy you
  name            = "${var.name_prefix}/order-timeline"
  log_group_names = local.log_group_names
  query_string    = <<-EOT
    fields @timestamp, function, level, message, outcome
    | filter orderId = "PASTE_ORDER_ID"
    | sort @timestamp asc
  EOT
}

resource "aws_cloudwatch_query_definition" "inventory_outcomes" {
  name            = "${var.name_prefix}/inventory-outcomes"
  log_group_names = local.log_group_names
  query_string    = <<-EOT
    filter message = "order processed"
    | stats count(*) as orders by outcome
  EOT
}

resource "aws_cloudwatch_query_definition" "lambda_performance" { # REPORT lines are written by Lambda itself, so this works without any app logging
  name            = "${var.name_prefix}/lambda-performance"
  log_group_names = local.log_group_names
  query_string    = <<-EOT
    filter @type = "REPORT"
    | stats count(*) as invocations, count(@initDuration) as coldStarts, avg(@duration) as avgMs, pct(@duration, 99) as p99Ms by @log
  EOT
}

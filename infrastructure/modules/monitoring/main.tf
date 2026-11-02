resource "aws_sns_topic" "ops_alerts" { # separate from order notifications: these go to operators, not customers
  name = "${var.name_prefix}-ops-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == null ? 0 : 1
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email" # AWS emails a confirmation link; nothing is delivered until it's clicked
  endpoint  = var.alarm_email
}

locals {
  alarm_actions = [aws_sns_topic.ops_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = var.lambda_function_names
  alarm_name          = "${var.name_prefix}-${each.key}-lambda-errors"
  alarm_description   = "${each.value} threw an unhandled error or timed out"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching" # Lambda publishes no Errors datapoints when nothing fails
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each            = var.lambda_function_names
  alarm_name          = "${var.name_prefix}-${each.key}-lambda-throttles"
  alarm_description   = "${each.value} was throttled - the account or function concurrency limit was hit"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name_prefix}-api-5xx"
  alarm_description   = "The HTTP API returned a 5xx - a Lambda error, timeout, or integration failure"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = var.api_id }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "api_4xx_rate" { # metric math: a rate, so a couple of 401s on a quiet API don't page anyone
  alarm_name          = "${var.name_prefix}-api-4xx-rate"
  alarm_description   = "More than ${var.api_4xx_rate_threshold_percent}% of API requests returned 4xx (with at least 20 requests in 5 minutes)"
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.api_4xx_rate_threshold_percent
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  metric_query {
    id = "errors"

    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "4xx"
      dimensions  = { ApiId = var.api_id }
      stat        = "Sum"
      period      = 300
    }
  }

  metric_query {
    id = "requests"

    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "Count"
      dimensions  = { ApiId = var.api_id }
      stat        = "Sum"
      period      = 300
    }
  }

  metric_query {
    id          = "rate"
    expression  = "IF(requests >= 20, 100 * errors / requests, 0)" # minimum-traffic guard
    label       = "4xx rate (%)"
    return_data = true # the alarm evaluates this query; the other two are inputs only
  }
}

resource "aws_cloudwatch_metric_alarm" "api_latency_p99" {
  alarm_name          = "${var.name_prefix}-api-latency-p99"
  alarm_description   = "API p99 latency above ${var.api_p99_latency_threshold_ms} ms for 10 minutes"
  namespace           = "AWS/ApiGateway"
  metric_name         = "Latency"
  dimensions          = { ApiId = var.api_id }
  extended_statistic  = "p99" # percentiles go here, not in statistic
  period              = 300
  evaluation_periods  = 2 # two periods, so a single cold start can't trip it
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.api_p99_latency_threshold_ms
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "queue_backlog" {
  alarm_name          = "${var.name_prefix}-order-queue-backlog"
  alarm_description   = "More than ${var.queue_backlog_threshold} orders waiting for 15 minutes - Inventory is stuck or too slow"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = var.queue_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.queue_backlog_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "queue_oldest_message_age" {
  alarm_name          = "${var.name_prefix}-order-queue-oldest-message-age"
  alarm_description   = "An order has waited over ${var.queue_oldest_message_age_threshold_seconds}s in the queue - normally seconds"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = var.queue_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.queue_oldest_message_age_threshold_seconds
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "dlq_messages" { # any DLQ message is an incident: an order that will never complete on its own
  alarm_name          = "${var.name_prefix}-order-dlq-messages"
  alarm_description   = "An order message exhausted its retries and is parked in the DLQ"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = var.dlq_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "pipe_failures" {
  alarm_name          = "${var.name_prefix}-orders-pipe-failures"
  alarm_description   = "The orders Pipe failed to publish stream records to EventBridge - OrderCreated events may be missing"
  namespace           = "AWS/EventBridge/Pipes"
  metric_name         = "ExecutionFailed"
  dimensions          = { PipeName = var.pipe_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rule_failed_invocations" {
  for_each            = var.event_rule_names
  alarm_name          = "${var.name_prefix}-${each.key}-rule-failed-invocations"
  alarm_description   = "Rule ${each.value} couldn't deliver to its target - often a missing resource policy"
  namespace           = "AWS/Events"
  metric_name         = "FailedInvocations"
  dimensions          = { EventBusName = var.event_bus_name, RuleName = each.value } # custom-bus rules need both dimensions
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

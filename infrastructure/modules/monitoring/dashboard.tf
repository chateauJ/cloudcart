data "aws_region" "current" { # the provider's region, so widgets don't hardcode us-east-1
}

locals {
  region = data.aws_region.current.name

  alarm_arns = concat(
    [for alarm in aws_cloudwatch_metric_alarm.lambda_errors : alarm.arn], # for_each resources are maps of instances
    [for alarm in aws_cloudwatch_metric_alarm.lambda_throttles : alarm.arn],
    [for alarm in aws_cloudwatch_metric_alarm.rule_failed_invocations : alarm.arn],
    [
      aws_cloudwatch_metric_alarm.api_5xx.arn,
      aws_cloudwatch_metric_alarm.api_4xx_rate.arn,
      aws_cloudwatch_metric_alarm.api_latency_p99.arn,
      aws_cloudwatch_metric_alarm.queue_backlog.arn,
      aws_cloudwatch_metric_alarm.queue_oldest_message_age.arn,
      aws_cloudwatch_metric_alarm.dlq_messages.arn,
      aws_cloudwatch_metric_alarm.pipe_failures.arn,
    ],
  )
}

resource "aws_cloudwatch_dashboard" "this" { # grid is 24 columns wide; widgets without x/y flow left to right
  dashboard_name = var.name_prefix

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "alarm"
        width  = 24
        height = 4
        properties = {
          title  = "Alarm status"
          region = local.region
          alarms = local.alarm_arns
        }
      },
      {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title  = "API requests and errors"
          region = local.region
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", var.api_id],
            ["AWS/ApiGateway", "4xx", "ApiId", var.api_id],
            ["AWS/ApiGateway", "5xx", "ApiId", var.api_id],
          ]
        }
      },
      {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title  = "API latency"
          region = local.region
          view   = "timeSeries"
          period = 300
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, { stat = "p50", label = "p50" }],
            ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, { stat = "p99", label = "p99" }],
          ]
        }
      },
      {
        type   = "metric"
        width  = 8
        height = 6
        properties = {
          title   = "Lambda invocations"
          region  = local.region
          view    = "timeSeries"
          stat    = "Sum"
          period  = 300
          metrics = [for key, name in var.lambda_function_names : ["AWS/Lambda", "Invocations", "FunctionName", name, { label = key }]]
        }
      },
      {
        type   = "metric"
        width  = 8
        height = 6
        properties = {
          title   = "Lambda errors"
          region  = local.region
          view    = "timeSeries"
          stat    = "Sum"
          period  = 300
          metrics = [for key, name in var.lambda_function_names : ["AWS/Lambda", "Errors", "FunctionName", name, { label = key }]]
        }
      },
      {
        type   = "metric"
        width  = 8
        height = 6
        properties = {
          title   = "Lambda duration p99"
          region  = local.region
          view    = "timeSeries"
          stat    = "p99"
          period  = 300
          metrics = [for key, name in var.lambda_function_names : ["AWS/Lambda", "Duration", "FunctionName", name, { label = key }]]
        }
      },
      {
        type   = "metric"
        width  = 8
        height = 6
        properties = {
          title  = "Orders pipe"
          region = local.region
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/EventBridge/Pipes", "Invocations", "PipeName", var.pipe_name],
            ["AWS/EventBridge/Pipes", "ExecutionFailed", "PipeName", var.pipe_name],
          ]
        }
      },
      {
        type   = "metric"
        width  = 8
        height = 6
        properties = {
          title  = "Event rule deliveries"
          region = local.region
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
          metrics = concat( # not flatten: it would also flatten each metric's own list
            [for key, name in var.event_rule_names : ["AWS/Events", "Invocations", "EventBusName", var.event_bus_name, "RuleName", name, { label = "${key} delivered" }]],
            [for key, name in var.event_rule_names : ["AWS/Events", "FailedInvocations", "EventBusName", var.event_bus_name, "RuleName", name, { label = "${key} failed" }]],
          )
        }
      },
      {
        type   = "metric"
        width  = 8
        height = 6
        properties = {
          title  = "Order queue"
          region = local.region
          view   = "timeSeries"
          stat   = "Maximum"
          period = 300
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.queue_name, { label = "queue depth" }],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.dlq_name, { label = "DLQ depth" }],
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.queue_name, { label = "oldest message (s)", yAxis = "right" }],
          ]
        }
      },
      {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title   = "DynamoDB reads (RCU)"
          region  = local.region
          view    = "timeSeries"
          stat    = "Sum"
          period  = 300
          metrics = [for key, name in var.dynamodb_table_names : ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", name, { label = key }]]
        }
      },
      {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title   = "DynamoDB writes (WCU)"
          region  = local.region
          view    = "timeSeries"
          stat    = "Sum"
          period  = 300
          metrics = [for key, name in var.dynamodb_table_names : ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", name, { label = key }]]
        }
      },
    ]
  })
}

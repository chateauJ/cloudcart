data "archive_file" "this" {
  type             = "zip"
  source_dir       = var.dist_dir
  output_path      = "${var.dist_dir}.zip"
  output_file_mode = "0666"
}

resource "aws_iam_role" "this" {
  name                 = "${var.function_name}-role"
  permissions_boundary = var.permissions_boundary_arn

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role_policy" "this" {
  name = "${var.function_name}-policy"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        for access in var.dynamodb_access : {
          Effect   = "Allow"
          Action   = access.actions
          Resource = access.resource_arns
        }
      ],
      var.sqs_event_source == null ? [] : [{
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = var.sqs_event_source.queue_arn
      }],
      [
        {
          Effect   = "Allow"
          Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "${aws_cloudwatch_log_group.this.arn}:*"
        },
        {
          Effect   = "Allow"
          Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
          Resource = "*" # X-Ray actions don't support resource-level permissions
        },
      ],
      var.extra_policy_statements,
    )
  })
}

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  role             = aws_iam_role.this.arn
  handler          = var.handler
  runtime          = var.runtime
  architectures    = [var.architecture]
  memory_size      = var.memory_size
  timeout          = var.timeout
  filename         = data.archive_file.this.output_path
  source_code_hash = data.archive_file.this.output_base64sha256

  environment {
    variables = merge(var.environment_variables, { LOG_LEVEL = var.log_level })
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.this]
}

resource "aws_lambda_event_source_mapping" "sqs" { # Lambda's poller reads the queue and invokes the function - no code polls SQS
  count                   = var.sqs_event_source == null ? 0 : 1
  event_source_arn        = var.sqs_event_source.queue_arn
  function_name           = aws_lambda_function.this.arn
  batch_size              = var.sqs_event_source.batch_size
  function_response_types = ["ReportBatchItemFailures"]
  depends_on              = [aws_iam_role_policy.this]
}

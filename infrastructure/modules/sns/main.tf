resource "aws_sns_topic" "this" {
  name = var.topic_name
}

resource "aws_sns_topic_subscription" "lambda" {
  for_each  = var.lambda_subscribers
  topic_arn = aws_sns_topic.this.arn
  protocol  = "lambda"
  endpoint  = each.value
}

resource "aws_lambda_permission" "sns" { # resource-based policy on the function: lets this topic invoke it
  for_each      = var.lambda_subscribers
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.this.arn
}

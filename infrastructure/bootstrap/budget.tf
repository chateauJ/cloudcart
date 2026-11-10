# Account-wide monthly cost budget - the backstop for having no WAF. Shield Standard absorbs network-layer
# floods and the API stage throttles requests, but a sustained flood of valid requests would still bill
# per request. This emails before that becomes a surprise. It lives here, not in an environment, because
# cost is per account: one budget covers dev, prod and the state backend together.
# The first two budgets in an account are free.
resource "aws_budgets_budget" "monthly" {
  name         = "${var.project_name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification { # spend has passed 80% of the limit
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alarm_email]
  }

  notification { # this month is on track to pass the limit - fires earlier than the actual-spend alert
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alarm_email]
  }
}

locals {
  account_id   = data.aws_caller_identity.current.account_id
  region       = var.aws_region
  app_prefixes = [for env in var.environments : "${var.project_name}-${env}"] # excludes the state backend and the CI role itself

  arn = {
    dynamodb = "arn:aws:dynamodb:${local.region}:${local.account_id}"
    sqs      = "arn:aws:sqs:${local.region}:${local.account_id}"
    sns      = "arn:aws:sns:${local.region}:${local.account_id}"
    lambda   = "arn:aws:lambda:${local.region}:${local.account_id}"
    events   = "arn:aws:events:${local.region}:${local.account_id}"
    pipes    = "arn:aws:pipes:${local.region}:${local.account_id}"
    logs     = "arn:aws:logs:${local.region}:${local.account_id}"
    alarms   = "arn:aws:cloudwatch:${local.region}:${local.account_id}"
    iam      = "arn:aws:iam::${local.account_id}"
  }

  app_role_arns = [for p in local.app_prefixes : "${local.arn.iam}:role/${p}-*"]
}

resource "aws_iam_policy" "workload_boundary" { # the most any role CI creates can ever do, whatever its own policy says
  name        = "${var.project_name}-workload-boundary"
  description = "Permissions boundary for CloudCart app roles - the union of what the Lambdas and the orders pipe need"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AppTableData"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
          "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
        ]
        Resource = [for p in local.app_prefixes : "${local.arn.dynamodb}:table/${p}-*"] # IAM's * also matches "/", so this covers the GSI too
      },
      {
        Sid      = "AppTableStreams"
        Effect   = "Allow"
        Action   = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"]
        Resource = [for p in local.app_prefixes : "${local.arn.dynamodb}:table/${p}-*/stream/*"]
      },
      {
        Sid      = "NoResourceLevelSupport"
        Effect   = "Allow"
        Action   = ["dynamodb:ListStreams", "xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "AppQueues"
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
        Resource = [for p in local.app_prefixes : "${local.arn.sqs}:${p}-*"]
      },
      {
        Sid      = "AppEventBuses"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = [for p in local.app_prefixes : "${local.arn.events}:event-bus/${p}-*"]
      },
      {
        Sid      = "AppLambdaLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [for p in local.app_prefixes : "${local.arn.logs}:log-group:/aws/lambda/${p}-*"]
      },
    ]
  })
}

resource "aws_iam_role_policy" "github_actions_state" {
  name = "terraform-state"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListStateBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.terraform_state.arn
      },
      {
        Sid      = "ReadWriteEnvironmentState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.terraform_state.arn}/environments/*" # the key prefix every backend.tf uses
      },
      {
        Sid      = "StateLocking"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.terraform_lock.arn
      },
    ]
  })
}

resource "aws_iam_role_policy" "github_actions_iam" { # CI may manage app roles only if they carry the boundary - no privilege escalation
  name = "app-roles"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ChangeAppRolesOnlyWithBoundary"
        Effect   = "Allow"
        Action   = ["iam:CreateRole", "iam:PutRolePolicy", "iam:PutRolePermissionsBoundary"]
        Resource = local.app_role_arns
        Condition = {
          StringEquals = { "iam:PermissionsBoundary" = aws_iam_policy.workload_boundary.arn }
        }
      },
      {
        # Read, delete and tag only. Deliberately absent: DeleteRolePermissionsBoundary and every
        # managed-policy action, so CI can neither remove the boundary nor rewrite it.
        Sid    = "ManageAppRoles"
        Effect = "Allow"
        Action = [
          "iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole", "iam:DeleteRole", "iam:DeleteRolePolicy",
          "iam:TagRole", "iam:UntagRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy",
        ]
        Resource = local.app_role_arns
      },
      {
        Sid      = "PassAppRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = local.app_role_arns
        Condition = {
          StringEquals = { "iam:PassedToService" = ["lambda.amazonaws.com", "pipes.amazonaws.com"] }
        }
      },
    ]
  })
}

resource "aws_iam_role_policy" "github_actions_services" {
  name = "app-services"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # service:* is safe here because every role CI can create is capped by the boundary,
        # and it survives provider upgrades that add new read calls to refresh
        Sid    = "AppResourcesByName"
        Effect = "Allow"
        Action = ["dynamodb:*", "sqs:*", "sns:*", "lambda:*", "events:*", "pipes:*", "logs:*", "cloudwatch:*"]
        Resource = flatten([for p in local.app_prefixes : [
          "${local.arn.dynamodb}:table/${p}-*", # also matches the table's /index/ and /stream/ ARNs
          "${local.arn.sqs}:${p}-*",
          "${local.arn.sns}:${p}-*", # subscriptions are <topic ARN>:<id>, so this covers them too
          "${local.arn.lambda}:function:${p}-*",
          "${local.arn.events}:event-bus/${p}-*",
          "${local.arn.events}:rule/${p}-*", # rules on a custom bus are rule/<bus>/<rule>
          "${local.arn.pipes}:pipe/${p}-*",
          "${local.arn.logs}:log-group:/aws/lambda/${p}-*",
          "${local.arn.logs}:log-group:/aws/apigateway/${p}-*",
          "${local.arn.alarms}:alarm:${p}-*",
          "arn:aws:cloudwatch::${local.account_id}:dashboard/${p}", # dashboards are global and named exactly the prefix
        ]])
      },
      {
        Sid    = "IdBasedServices" # these ARNs use generated IDs, not names, so scope to the account and region
        Effect = "Allow"
        Action = ["apigateway:*", "cognito-idp:*"]
        Resource = [
          "arn:aws:apigateway:${local.region}::/apis",
          "arn:aws:apigateway:${local.region}::/apis/*",
          "arn:aws:apigateway:${local.region}::/tags/*",
          "arn:aws:cognito-idp:${local.region}:${local.account_id}:userpool/*",
        ]
      },
      {
        Sid    = "NoResourceLevelSupport"
        Effect = "Allow"
        Action = [
          "lambda:CreateEventSourceMapping", "lambda:GetEventSourceMapping", "lambda:UpdateEventSourceMapping",
          "lambda:DeleteEventSourceMapping", "lambda:ListEventSourceMappings",
          "cognito-idp:CreateUserPool",
          "logs:DescribeLogGroups", "logs:PutQueryDefinition", "logs:DescribeQueryDefinitions",
          "logs:DeleteQueryDefinition",
          # API Gateway access logging delivers through these
          "logs:CreateLogDelivery", "logs:GetLogDelivery", "logs:UpdateLogDelivery", "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries", "logs:PutResourcePolicy", "logs:DescribeResourcePolicies",
        ]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = local.region }
        }
      },
    ]
  })
}

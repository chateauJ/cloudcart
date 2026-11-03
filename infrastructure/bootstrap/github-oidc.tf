resource "aws_iam_openid_connect_provider" "github" { # one per account - lets IAM verify GitHub-signed tokens
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "github_actions" {
  name = "${var.project_name}-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          # main-branch jobs and the dev/prod environment jobs only - pull requests never get AWS credentials.
          # The repo uses GitHub's immutable subject (owner@id/repo@id), so a recreated repo of the same name can't match.
          "token.actions.githubusercontent.com:sub" = concat(
            ["repo:${var.github_repository}:ref:refs/heads/main"],
            [for env in var.environments : "repo:${var.github_repository}:environment:${env}"],
          )
        }
      }
    }]
  })
}

variable "name" { type = string }
variable "github_subject_prefix" { type = string }
variable "backups_bucket_arn" { type = string }
variable "repository_arns" { type = list(string) }
variable "server_instance_arn" { type = string }

# Lets GitHub Actions deploy without stored AWS keys: GitHub proves its identity with a
# short-lived token, and AWS trusts it only for the conditions below.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "deploy" {
  name = "${var.name}-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          # The repository is public, so only runs on the master branch may deploy. Pull
          # requests (including from forks) get a different subject and are refused. Also
          # protect master with required pull requests, so only reviewed code reaches it.
          "token.actions.githubusercontent.com:sub" = "${var.github_subject_prefix}:ref:refs/heads/master"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "deploy" {
  name = "deploy-access"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "PushImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:DescribeImages",
        ]
        Resource = var.repository_arns
      },
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "StageComposeFiles"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${var.backups_bucket_arn}/deploy/*"
      },
      {
        Sid      = "RunDeployOnServer"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand"]
        Resource = [var.server_instance_arn, "arn:aws:ssm:*::document/AWS-RunShellScript"]
      },
      {
        Sid      = "FindServerAndReadResult"
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances", "ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
        Resource = "*"
      },
    ]
  })
}

output "deploy_role_arn" { value = aws_iam_role.deploy.arn }

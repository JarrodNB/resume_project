variable "name" { type = string }
variable "domain" { type = string }

# Amazon SES sends the app's account emails (verification, password reset). The domain is
# proven through DKIM records added at the DNS host; see the dns_records output.
resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.domain
}

# SES SMTP takes IAM user credentials, so this user can do nothing except send email.
resource "aws_iam_user" "smtp" {
  name = "${var.name}-ses-smtp"
}

resource "aws_iam_user_policy" "smtp" {
  name = "send-email"
  user = aws_iam_user.smtp.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ses:SendRawEmail"
      Resource = aws_sesv2_email_identity.domain.arn
    }]
  })
}

resource "aws_iam_access_key" "smtp" {
  user = aws_iam_user.smtp.name
}

output "dkim_tokens" {
  value = aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens
}

output "smtp_username" {
  value = aws_iam_access_key.smtp.id
}

output "smtp_password" {
  value     = aws_iam_access_key.smtp.ses_smtp_password_v4
  sensitive = true
}

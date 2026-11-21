variable "name" { type = string }
variable "domain" { type = string }
variable "alert_email" { type = string }

# Checks the three public addresses every 15 minutes from outside the server. The function
# fails when any of them does not answer 200, and a CloudWatch alarm on that failure emails
# once when the site goes down and once when it recovers. Cost is effectively zero: the
# function runs about 2,900 times a month and SNS email is free.
data "archive_file" "check" {
  type        = "zip"
  output_path = "${path.module}/check.zip"

  source {
    filename = "check.py"
    content  = <<-PY
      import os
      import time
      import urllib.request

      def check(url):
          try:
              with urllib.request.urlopen(url, timeout=10) as response:
                  return None if response.status == 200 else f"{url} returned {response.status}"
          except Exception as error:
              return f"{url} failed: {error}"

      def handler(event, context):
          failed = []
          for url in os.environ["URLS"].split(","):
              problem = check(url)
              if problem:
                  time.sleep(5)  # one retry, so a single dropped request does not send an alert
                  problem = check(url)
              if problem:
                  failed.append(problem)
          if failed:
              raise RuntimeError("; ".join(failed))
    PY
  }
}

resource "aws_iam_role" "check" {
  name = "${var.name}-uptime-check"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.check.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "check" {
  function_name    = "${var.name}-uptime-check"
  role             = aws_iam_role.check.arn
  runtime          = "python3.12"
  handler          = "check.handler"
  filename         = data.archive_file.check.output_path
  source_code_hash = data.archive_file.check.output_base64sha256
  timeout          = 40

  environment {
    variables = {
      URLS = "https://${var.domain},https://app.${var.domain},https://api.${var.domain}/up"
    }
  }
}

resource "aws_cloudwatch_log_group" "check" {
  name              = "/aws/lambda/${aws_lambda_function.check.function_name}"
  retention_in_days = 7
}

resource "aws_cloudwatch_event_rule" "every_fifteen_minutes" {
  name                = "${var.name}-uptime-check"
  schedule_expression = "rate(15 minutes)"
}

resource "aws_cloudwatch_event_target" "check" {
  rule = aws_cloudwatch_event_rule.every_fifteen_minutes.name
  arn  = aws_lambda_function.check.arn
}

resource "aws_lambda_permission" "events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.check.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.every_fifteen_minutes.arn
}

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-uptime-alerts"
}

# AWS emails a confirmation link to this address; alerts start after it is clicked.
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "down" {
  alarm_name          = "${var.name}-site-down"
  alarm_description   = "careerdrafter.app, app. or api. did not answer 200"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.check.function_name }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# The server publishes root disk use with a cron job (/etc/cron.d/jobapp-disk, see
# infra/compose/README.md). A full disk stops Postgres writes. Missing data counts as breaching,
# so this also fires if the server stops reporting at all.
resource "aws_cloudwatch_metric_alarm" "disk" {
  alarm_name          = "${var.name}-disk-nearly-full"
  alarm_description   = "Root disk is over 80% full, or the server stopped reporting"
  namespace           = "${var.name}/Server"
  metric_name         = "RootDiskUsedPercent"
  statistic           = "Maximum"
  period              = 900
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

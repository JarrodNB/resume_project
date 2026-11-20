variable "name" { type = string }

# Mirrors infra/elasticmq/elasticmq.conf so local dev and production behave the same.
locals {
  queues = {
    ai_tasks   = { visibility_timeout = 300 }
    ai_results = { visibility_timeout = 60 }
  }
}

resource "aws_sqs_queue" "dead_letters" {
  for_each = local.queues

  name                      = "${var.name}-${each.key}-dead-letters"
  message_retention_seconds = 1209600
}

# Long polling (20s) keeps the empty-receive request count, and the bill, near zero.
resource "aws_sqs_queue" "this" {
  for_each = local.queues

  name                       = "${var.name}-${each.key}"
  visibility_timeout_seconds = each.value.visibility_timeout
  receive_wait_time_seconds  = 20

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letters[each.key].arn
    maxReceiveCount     = 3
  })
}

output "queue_urls" { value = { for k, q in aws_sqs_queue.this : k => q.url } }

output "queue_arns" {
  value = concat(
    [for q in aws_sqs_queue.this : q.arn],
    [for q in aws_sqs_queue.dead_letters : q.arn],
  )
}

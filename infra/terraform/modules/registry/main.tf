variable "name" { type = string }

locals {
  repositories = ["api", "ai", "web", "landing"]
}

resource "aws_ecr_repository" "this" {
  for_each = toset(local.repositories)

  name = "${var.name}/${each.key}"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Storage is billed per GB, so keep only recent images (enough to roll back).
resource "aws_ecr_lifecycle_policy" "this" {
  for_each = aws_ecr_repository.this

  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

output "repository_urls" { value = { for k, r in aws_ecr_repository.this : k => r.repository_url } }
output "repository_arns" { value = [for r in aws_ecr_repository.this : r.arn] }

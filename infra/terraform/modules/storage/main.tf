variable "name" { type = string }
variable "domain" { type = string }

data "aws_caller_identity" "current" {}

locals {
  suffix = data.aws_caller_identity.current.account_id
}

# Uploads
resource "aws_s3_bucket" "uploads" {
  bucket = "${var.name}-uploads-${local.suffix}"
}

# Backups
resource "aws_s3_bucket" "backups" {
  bucket = "${var.name}-backups-${local.suffix}"
}

# Both buckets stay private and encrypted.
resource "aws_s3_bucket_public_access_block" "this" {
  for_each = {
    uploads = aws_s3_bucket.uploads.id
    backups = aws_s3_bucket.backups.id
  }

  bucket                  = each.value
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = {
    uploads = aws_s3_bucket.uploads.id
    backups = aws_s3_bucket.backups.id
  }

  bucket = each.value

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The web app uploads interview recordings straight to the uploads bucket with a signed URL,
# so the browser needs CORS permission for PUT. Interviewer audio plays from a signed GET URL.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["https://app.${var.domain}"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# Backup retention. The privacy checklist promises backups are deleted after 30 days,
# so this must match docs/operations/privacy-and-legal-launch.md.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-backups"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

output "uploads_bucket" { value = aws_s3_bucket.uploads.bucket }
output "uploads_bucket_arn" { value = aws_s3_bucket.uploads.arn }
output "backups_bucket" { value = aws_s3_bucket.backups.bucket }
output "backups_bucket_arn" { value = aws_s3_bucket.backups.arn }

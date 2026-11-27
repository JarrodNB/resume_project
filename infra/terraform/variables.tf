variable "region" {
  description = "AWS region. The AWS project is locked to a single region."
  type        = string
  default     = "us-east-2"
}

variable "name" {
  description = "Prefix for resource names. Bucket names are global and hard to rename, so settle the brand name before the first apply."
  type        = string
  default     = "jobapp"
}

variable "instance_type" {
  description = "EC2 size. 4 GiB of RAM holds Postgres, Rails, the AI workers and the live interview agent (ai-live); raise it if the server swaps."
  type        = string
  default     = "t3.medium"
}

variable "postgres_volume_gb" {
  description = "Size of the EBS volume that holds Postgres data."
  type        = number
  default     = 20
}

variable "github_subject_prefix" {
  description = "How GitHub names this repository in its identity tokens. This repository uses immutable subjects (owner and repository IDs), so it is not owner/name. Check with: gh api repos/OWNER/REPO/actions/oidc/customization/sub"
  type        = string
  default     = "repo:JarrodNB@20782388/resume_project@1415027277"
}

variable "domain" {
  description = "Domain the app is served from; account emails are sent from it."
  type        = string
  default     = "careerdrafter.app"
}

variable "alert_email" {
  description = "Where site-down alerts are sent."
  type        = string
  default     = "jnb.cb38@gmail.com"
}

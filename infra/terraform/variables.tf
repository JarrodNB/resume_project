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
  description = "EC2 size. 2 GiB of RAM is tight for Postgres, Rails and the AI workers together; raise it if the server swaps."
  type        = string
  default     = "t3.small"
}

variable "postgres_volume_gb" {
  description = "Size of the EBS volume that holds Postgres data."
  type        = number
  default     = 20
}

variable "github_repository" {
  description = "GitHub repository (owner/name) whose master branch may deploy."
  type        = string
  default     = "JarrodNB/resume_project"
}

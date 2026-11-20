output "server_public_ip" {
  description = "Static address of the server. Point the domain's A record here."
  value       = module.server.public_ip
}

output "server_instance_id" {
  description = "Use with `aws ssm start-session --target` to open a shell; no SSH port is open."
  value       = module.server.instance_id
}

output "uploads_bucket" {
  value = module.storage.uploads_bucket
}

output "backups_bucket" {
  value = module.storage.backups_bucket
}

output "queue_urls" {
  value = module.queues.queue_urls
}

output "repository_urls" {
  value = module.registry.repository_urls
}

output "github_deploy_role_arn" {
  description = "Role the deploy workflow assumes (set as AWS_ROLE_ARN in .github/workflows/deploy.yml)."
  value       = module.github.deploy_role_arn
}

# Production stack for the single-server hosting decision in docs/architecture.md.

module "storage" {
  source = "./modules/storage"
  name   = var.name
}

module "queues" {
  source = "./modules/queues"
  name   = var.name
}

module "registry" {
  source = "./modules/registry"
  name   = var.name
}

module "server" {
  source             = "./modules/server"
  name               = var.name
  instance_type      = var.instance_type
  postgres_volume_gb = var.postgres_volume_gb
  uploads_bucket_arn = module.storage.uploads_bucket_arn
  backups_bucket_arn = module.storage.backups_bucket_arn
  queue_arns         = module.queues.queue_arns
  repository_arns    = module.registry.repository_arns
}

module "github" {
  source                = "./modules/github"
  name                  = var.name
  github_subject_prefix = var.github_subject_prefix
  backups_bucket_arn    = module.storage.backups_bucket_arn
  repository_arns       = module.registry.repository_arns
  server_instance_arn   = module.server.instance_arn
}

module "email" {
  source = "./modules/email"
  name   = var.name
  domain = var.domain
}

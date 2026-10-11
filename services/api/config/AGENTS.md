# AGENTS.md — services/api/config

## Purpose

Rails environment, routes, middleware, and initialization configuration.

## Contents

- `application.rb`
- `boot.rb`
- `bundler-audit.yml`
- `cable.yml`
- `cache.yml`
- `ci.rb`
- `credentials.yml.enc`
- `database.yml`
- `environment.rb`
- `environments` — subfolder; inherits these rules unless overridden locally.
- `initializers` — subfolder; inherits these rules unless overridden locally.
- `locales` — subfolder; inherits these rules unless overridden locally.
- `master.key`
- `puma.rb`
- `queue.yml`
- `recurring.yml`
- `routes.rb`
- `shoryuken.yml`
- `storage.yml`

## Local Rules

Follow services/api/AGENTS.md. Read secrets from environment variables. Keep service-specific configuration compatible with Docker development and production.

# AGENTS.md — services/api/app

## Purpose

Rails domain, GraphQL, HTTP, background jobs, and queue consumers.

## Contents

- `channels` — subfolder; inherits these rules unless overridden locally.
- `controllers` — subfolder; inherits these rules unless overridden locally.
- `graphql` — subfolder; inherits these rules unless overridden locally.
- `jobs` — subfolder; inherits these rules unless overridden locally.
- `mailers` — subfolder; inherits these rules unless overridden locally.
- `models` — subfolder; inherits these rules unless overridden locally.
- `services` — subfolder; inherits these rules unless overridden locally.
- `views` — subfolder; inherits these rules unless overridden locally.
- `workers` — subfolder; inherits these rules unless overridden locally.

## Local Rules

Follow services/api/AGENTS.md. Models hold associations/validation; business logic belongs in services. Interview operations preserve owned data and AI usage records.

# AGENTS.md — services/api/spec/graphql

## Purpose

Schema-level operation tests and schema dump verification.

## Contents

- `mutations` — subfolder; inherits these rules unless overridden locally.
- `queries` — subfolder; inherits these rules unless overridden locally.
- `schema_dump_spec.rb`

## Local Rules

Use execute_graphql from spec/support with authenticated users. Include ownership checks; regenerate the SDL rather than changing schema dump expectations to hide drift.

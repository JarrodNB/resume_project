# AGENTS.md — services/api/app/controllers

## Purpose

HTTP entry points. Kept minimal: REST for auth, a single GraphQL endpoint for everything else.

## Contents

- `graphql_controller.rb` — `POST /graphql`; requires a JWT, puts `current_user` in context
- `auth/sessions_controller.rb` — `POST /auth/sign_in`, `DELETE /auth/sign_out`
- `auth/registrations_controller.rb` — `POST /auth/sign_up`
- `concerns/fake_rack_session.rb` — no-op session so Devise works in API-only mode

## Local Rules

- The JWT is returned in the `Authorization` response header (`Bearer ...`) on sign-in and
  sign-up; clients send it back in the `Authorization` request header.
- Don't add REST endpoints for domain data; add GraphQL fields instead.

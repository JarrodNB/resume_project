# AGENTS.md — services/api/app/controllers

## Purpose

HTTP entry points. Kept minimal: REST for auth, a single GraphQL endpoint for everything else.

## Contents

- `graphql_controller.rb` — `POST /graphql`; requires a session, puts `current_user` in context
- `auth/sessions_controller.rb` — session bootstrap, `POST /auth/sign_in`, `DELETE /auth/sign_out`
- `auth/registrations_controller.rb` — `POST /auth/sign_up`
- `auth/confirmations_controller.rb` — resend and explicit POST verification; no GET consumes links
- `auth/passwords_controller.rb` — recovery request/reset and signed-in current-password change;
  only password fields, no auto-login or account edit/delete

## Local Rules

- Browser identity comes from a server-side Rails session with an HttpOnly cookie.
  Bootstrap returns safe user state and a Rails CSRF token. Unsafe requests require
  CSRF; do not introduce bearer-token or query-token alternatives.
- Preserve the shared persisted-session validity check and no-store response headers.
- Don't add REST endpoints for domain data; add GraphQL fields instead.

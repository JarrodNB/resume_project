# Authentication boundary audit

This is a focused code/test audit of the user login/signup candidate based on
`bfbae4b78fc917d3689b64f7032ddd9c47743de4`, followed by the two HTTP ownership
examples added in this ticket. It is not a certification of every domain feature,
external proxy, provider, or production environment. No new product defect was
confirmed in this pass. The added tests check already-supported behavior; they
passed on their first execution, so there is no fabricated red/green claim.

## Inspected boundaries and evidence

Paths below are relative to the repository root. Checks run through Docker; email,
SQS and AI/provider effects are replaced at their existing test boundaries.

| Boundary | Inspected implementation | Executable evidence |
| --- | --- | --- |
| Login, legacy passwords and new-password policy | `services/api/app/models/user.rb`, `app/controllers/auth/sessions_controller.rb`, `config/initializers/devise.rb` | `spec/requests/{auth,password_policy,email_verification}_spec.rb`, `spec/models/user_password_spec.rb`: generic invalid/unconfirmed login; legacy short/oversized Unicode hashes still work; new choices enforce minimum/common-password/72-byte bounds without truncation |
| Signup/verification/resend | `services/api/app/services/accounts/register_account_service.rb`, `confirm_account_service.rb`, `app/controllers/auth/confirmations_controller.rb` | `spec/requests/email_verification_spec.rb`, `spec/services/accounts/confirmation_concurrency_spec.rb`: generic duplicates, row-lock token races, expired/reused/superseded input, queue failure/retry and unchanged existing credentials |
| Recovery/current-password change | `services/api/app/services/accounts/{request_password_reset,reset_password,change_password}_service.rb`, `app/controllers/auth/passwords_controller.rb` | `spec/requests/password_recovery_spec.rb`, `spec/services/accounts/password_concurrency_spec.rb`: invalid/partial input, current-password check, no confirmation bypass, two-browser captured-cookie revocation and real reset/change/sign-in races |
| HTTP session and forgery boundary | `services/api/config/application.rb`, `config/initializers/session_store.rb`, `app/controllers/application_controller.rb`, `app/services/browser_sessions/resolve_session_identity_service.rb` | `spec/requests/browser_sessions_spec.rb`, `session_store_revocation_spec.rb`: real middleware cookie login/rotation, server absolute expiry, JSON and real multipart CSRF, hostile Origin, deleted-row replay/in-flight write cannot restore access |
| GraphQL reads | `services/api/app/controllers/graphql_controller.rb`, `app/graphql/types/query_type.rb` | `spec/graphql/queries/scoping_spec.rb`, new `spec/requests/account_ownership_spec.rb`: signed-in user's jobs only; another account's ID returns the same Record-not-found error; real logout/relogin switches cookie identity |
| GraphQL writes | `services/api/app/graphql/mutations/jobs/update_job.rb`, `delete_job.rb`, `mutations/base_mutation.rb` | `spec/graphql/mutations/jobs_spec.rb`, new `spec/requests/account_ownership_spec.rb`: `current_user.jobs.find` rejects another user's update/delete and persists no cross-account change |
| Upload and accepted import ownership | `services/api/app/graphql/mutations/resume_imports/{parse_resume,import_parsed_resume}.rb`, `app/services/resume_imports/start_resume_parsing_service.rb` | `spec/requests/browser_sessions_spec.rb`, new `account_ownership_spec.rb`, `spec/graphql/mutations/resume_imports_spec.rb`: real multipart binds blob/task to cookie owner; second account cannot read the task or accept someone else's import; byte/type caps and queue boundary retained |
| Live handshake, subscription and transmission | `services/api/app/channels/application_cable/connection.rb`, `app/channels/graphql_channel.rb`, `app/graphql/subscriptions/ai_task_updated.rb` | `spec/channels/application_cable/browser_connection_spec.rb`, `spec/channels/graphql_channel_spec.rb`, `spec/requests/session_store_revocation_spec.rb`: actual cookie middleware handshake; missing/unconfirmed/expired/old URL token rejected; owned task subscription; revocation blocks operation/private transmit before heartbeat closes socket |
| Browser state/account transitions | `apps/web/src/features/auth/AuthProvider.tsx`, `authApi.ts`, `RequireAuth.tsx`, `apps/web/src/graphql/{SessionApolloProvider.tsx,createApolloClient.ts}` | colocated auth/GraphQL tests: bootstrap retry, stale response ignored, credentialed CSRF uploads, cache/client replacement and socket disposal, broadcast notices contain no credentials, 401 clears old account state |
| Token links and logging | `apps/web/src/main.tsx`, `features/auth/{confirmationLink,resetPasswordLink}.ts`, `services/api/app/mailers/account_mailer.rb`, `app/jobs/account_mail_delivery_job.rb`, `config/initializers/{account_email,filter_parameter_logging}.rb` | `EmailVerification.test.tsx`, `PasswordRecovery.test.tsx`, `spec/requests/{email_verification,password_recovery}_spec.rb`, `spec/jobs/account_mail_{delivery_job,queue_privacy}_spec.rb`: fragment captured/cleared before mount, explicit POST/PUT only, configured web host, sanitized bounded retries, actual Solid Queue argument SQL hidden even at application DEBUG |
| Throttles/origins/request size | `services/api/config/initializers/{rack_attack,cors,text_limits}.rb`, `config/environments/production.rb` | `spec/requests/{rack_attack,browser_session_abuse,browser_sessions,max_request_body}_spec.rb`: explicit credentialed origins, JSON 429/Retry-After, normalized email, malformed JSON shapes, byte-bound body; proxy/client-IP/shared-store deployment assumptions still require environment verification |
| Migration and restricted reader | `services/api/db/migrate/20261019030000_add_email_confirmation_to_users.rb`, `lib/ai_reader_access.rb` | `spec/lib/{email_confirmation_migration,ai_reader_access}_spec.rb`: only migration-time accounts grandfathered; IDs/hashes/data retained; auth columns and session/queue tables absent from AI-reader grants |

The `app/...`, `config/...` and `spec/...` shorthand in API cells means
`services/api/` paths. These are representative ownership paths, not an exhaustive
review of every nested field or storage-sharing URL.

## Secret and dependency trace

The JWT strategy/gem is gone. Source search of current HTTP auth, Cable and browser
transports finds no bearer decode/dispatch or URL token construction. The legacy
JWT denylist model/table is inert and retained for additive rollout. HTTP rejects
a bearer-only request; Cable rejects a URL-token-only connection. AuthProvider
removes the old browser storage key; no replacement credential is returned to JS.
CSRF tokens are intentionally browser-readable state, not session credentials.

Recovery digests and Devise raw confirmation tokens remain restricted DB data.
Queued mail must contain the delivery token; restricting queue/backup access is
part of setup. Local delivered mail files also contain usable links. Request
filters, disabled mail logging, hidden job arguments, sanitized SMTP exceptions,
and the independent INFO SQL logger cover the inspected app logs. This does not
prove an external proxy/APM/browser extension never captures bodies; configure
those systems to exclude account bodies, cookies and links before production.
No third-party browser telemetry currently initializes before token capture.

The primary DB is required by the shared identity service; no cache/local/JWT
fallback grants access on lookup failure. Malformed account envelopes fail safely.
SMTP/queue failures are tested without granting access or changing passwords, and
are recoverable by resend. Existing in-flight domain requests authorized before
password change may finish; new requests and each private transmit recheck state.

No gems, npm dependencies, lockfiles or crypto implementations changed in this
ticket. The earlier selection evidence for Rails session store 2.3.0 and
Devise uncommon-password 0.4.9 is in
[Browser authentication](../architecture/authentication.md).

## Advisory and verification outcomes

Audit date: 2026-10-20 (Asia/Manila). Runtime checks used the locked app dependencies
in Docker. Actual commands are the runbook's commands with Compose project
`cg-auth-05`, source from the ticket checkout, API image `cg-auth-02-api:latest`,
web image `cg-auth-integration-web:latest`, no published test dependency ports,
and private named data volumes. The API bundle volume was reused without
dependency installation; source mounts came from this ticket.

- Final combined full API: **544 examples, zero failures**, including the two
  added HTTP ownership examples. Those two also passed on first focused execution.
- TypeScript and frontend lint passed. Brakeman: zero warnings/errors.
- Ruby lint: seven existing offenses in untouched profile-link type files and
  service specs; no auth offenses. These were independently reproduced on the
  original feature base earlier in delivery.
- Full frontend single-worker rerun: **191 passed, four failed**, all four in
  unchanged `InterviewPrepPage.test.tsx` with missing career-library Apollo mocks.
  Those failures were independently reproduced on the unchanged original base
  earlier in delivery. All other 41 test files passed, including auth/GraphQL.
  The first run under simultaneous checks had 184 passed, 11 failed including
  timeouts; the serial rerun removed the seven resource-contention failures.
- `bundle exec bundler-audit check --update` successfully cloned/refreshed
  ruby-advisory-db, 1266 advisories, commit
  `fa2295251efb3b0d1a300e5ce8ad700ff1f1b485`, last updated 2026-10-17
  20:01:16+0200: no vulnerabilities found. This was a network-backed refresh,
  not a stale/offline success.
- `npm audit --json` reached the registry and reported 10 high entries, all from
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  (CVE-2026-93687). The reviewed primary advisory says `braces<=3.0.3` is affected
  by deeply nested pattern stack exhaustion and lists no patched version as of
  this check. The lock contains braces 3.0.3 via development-only GraphQL codegen's
  glob loaders/micromatch. npm propagates this one advisory to ten package entries;
  it does not mean ten independent auth flaws. `npm audit --omit=dev --json`
  returned zero vulnerabilities. The lockfile is unchanged from the feature base.
  No runtime auth path accepts a user glob pattern or invokes codegen. Do not
  process untrusted glob configuration in developer/CI jobs. Track an upstream
  fix and rerun the audit; npm's suggested major downgrade to codegen 3.2.0 is not
  a safe automatic fix and was not applied. This existing tooling advisory is
  explicitly unresolved, outside the account implementation scope.

`docker compose ... -f infra/compose.auth-review.yml config --quiet` passed.
Production-environment `accounts:email_preflight` rejected absent configuration
with only missing variable names, and passed with synthetic complete settings
without connecting or sending. Production-environment boot assertions also passed
for host-only HttpOnly/Secure/SameSite cookies, exact configured Cable origins,
required STARTTLS and the Solid Cache default, without provider calls. The
production-image library setup itself was not exercised; the development image
printed an existing missing-libvips notice, which does not affect this mail check.
A mechanical check resolved all 61 cited code-path groups; relative documentation
links and `git diff --check` also passed.

The operator runbook includes a Compose-validated, cookie-isolated local overlay,
production SMTP preflight/human smoke test, shared cache and proxy prerequisites,
session retention/capacity, worker recovery, coordinated cutover and rollback
without reviving old JWTs. Configuration validation is not proof of deployed TLS,
email delivery, provider DNS, cache replicas, capacity or proxy behavior.

No browser automation/manual browser review, production provisioning/deployment,
real provider email, paid AI call, broad storage audit, or penetration test was
performed. Human QA and production setup remain required. Full final review of
the integrated feature belongs to the coordinator's later delivery gates.

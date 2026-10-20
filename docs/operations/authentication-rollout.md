# Account rollout and human QA

This runbook covers the cookie-session, password-policy, verification and recovery
candidate. It is a release checklist, not evidence that production was configured
or deployed. The behavior and API contracts live in
[Browser authentication](../architecture/authentication.md); the inspected code
and test evidence live in [the audit](../security/authentication-audit.md).

Careergrind currently runs only in local development. Production steps below are
future setup guidance; local review uses file mail and needs no SMTP provider.

The unreleased auth migrations now use `20261020010000` and `20261020020000` to
avoid numbers independently used by the job-board migrations on master. A normal
master development database upgrades with `db:prepare`, preserving existing data.
Disposable auth review databases created from the earlier ticket branches have
the old numbers and should be recreated using only their dedicated QA project.
Do not edit migration history or reset the main application database to fix a
review database; preserve any real data and investigate its schema separately.

## Before production traffic

1. Back up the primary database and test restore access. Rehearse additive migrations
   against a representative sanitized database. `20261020010000` adds the session
   table/indexes; `20261020020000` adds confirmation columns/index and confirms only
   users present during migration. Existing reset digest/timestamp columns need no
   new migration. Do not run the confirmation backfill again manually.
2. Pause registration while migrating and deploying. Old code can still insert
   accounts without confirmation, and an old/new rolling mix has incompatible auth
   transports. Drain API/Cable traffic, deploy API and web together, purge stale
   cached web bundles, then reopen traffic. Existing users must log in again.
   Preserve user IDs, password hashes and saved data. Prepare primary, cache, queue
   and cable databases using the deployment's `bin/rails db:prepare`; ensure the
   restricted `ai_reader` grants are reapplied. Never grant that role SELECT on
   sessions, queues or all user columns.
3. Set stable shared Rails secrets on API and workers. Serve web and API over HTTPS
   on the same site (for example `app.example.com` and `api.example.com`). Set
   `CORS_ORIGINS` to exact HTTPS web origins and `WEB_APP_URL` to the HTTPS web origin.
   No wildcard, paths or unrelated-site hosting. Production cookies must be host
   scoped, HttpOnly, Secure and SameSite=Lax. Devise's HTTP credentials and Cable
   must continue rejecting old bearer/URL tokens.
4. Keep Rails `assume_ssl`/`force_ssl` behind a trusted TLS terminator. Restrict direct
   access to API instances; make the proxy overwrite forwarded headers and strip
   client-supplied forwarding values. Check Rack's effective client IP behind the
   actual proxy: two controlled client IPs should get separate throttle buckets,
   while spoofed forwarding headers must not evade one client's limit. Check Rails
   Host restrictions/load-balancer routing for the actual API domain. Repository
   defaults do not prove those external controls exist.
5. Production Rails uses Solid Cache in the shared cache database. Prepare that
   schema and verify all API replicas use the same store/namespace. Rack::Attack
   counters are only as effective as that shared store and correct client-IP
   forwarding. Memory/null cache or per-replica isolated databases do not provide
   the documented deployment-wide throttles. Test a controlled 429 and Retry-After
   across replicas without targeting other users.
6. Configure the verified `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (587 or 2525),
   `SMTP_DOMAIN`, `SMTP_USERNAME`, `SMTP_PASSWORD` as secrets. Run
   `bin/rails accounts:email_preflight` inside the configured release container.
   The command prints only readiness/missing variable names; it does not connect,
   authenticate, validate provider ownership or send. Required STARTTLS and normal
   certificate validation must remain enabled. Sender/domain DNS and provider setup
   remain deployment work.
7. Run Rails `bin/jobs` against the shared queue database as a supervised process;
   its `queues: "*"` includes account mail. API-only health `/up` does not prove
   worker readiness, shared-cache operation or mail delivery. Monitor worker
   heartbeat, mail queue age/failures and database availability before reopening
   signup/recovery. Rails mail uses neither SQS nor AI workers.

Run a human-controlled production smoke test only after setup: register a dedicated
owned address, verify the actual received sender and spam placement, follow the
HTTPS fragment link, confirm and sign in, request recovery, change the password and
prove two old browser sessions lose HTTP/live access. Repeat resend and confirm only
the latest link works. Never paste a token, full link, password, cookie, raw queue
row or mail body into logs, tickets or screenshots. Record timestamps and outcomes
without secrets. This smoke test has not been performed by the coding agent.

## Capacity, delivery failures and recovery

The primary DB is the session source of truth. Check its connection pool, latency,
row count and disk growth under expected login/bootstrap load. HTTP validation and
Cable private sends/heartbeats query it; estimate capacity with the real number of
open sockets and API replicas. Schedule this daily in the API release environment:

```bash
SESSION_DAYS_TRIM_THRESHOLD=2 bin/rails db:sessions:trim
```

The two-day retention exceeds the one-day absolute auth lifetime; trimming does
not enforce expiry. The gem default is 30 days.
Use a database-specific monitoring account to count rows, not to dump session data.

SMTP has five-second connection/read limits and at most three job attempts. Alert
on final failures and oldest queued mail. Restore provider/credentials/TLS or worker
availability first, rerun the preflight, then ask the controlled user to resend.
Resend supersedes old links, including messages still queued. A late old message
can arrive but cannot verify/reset after supersession. Failed SMTP does not confirm
an account or change its password. Development async jobs are in memory and may be
lost on restart; resend recovers. Do not replay raw job arguments in diagnostics.

A primary DB outage blocks authentication; restore it and let clients retry.
A shared cache outage can impair abuse protection, so do not treat `/up` alone as
release readiness. Queue failures produce generic public email-request responses
and sanitized operational events; users can retry after recovery. Watch generic
`Account email enqueue failed` / `Account email delivery failed` events and failed
job counts. Mail bodies/job arguments and SQL DEBUG are intentionally hidden.
Restrict database/backups/local `tmp/mails` to operators; delete local mail after QA.

## Rollback

Prefer a forward fix or a previously verified release that retains cookie auth,
verification and password policy. Stop admission and drain existing API/Cable
connections before changing both API and web versions. Preserve additive session
and confirmation tables/columns; do not run migration `down` or restore old hashes
as a routine rollback. Preserve account/profile and AI history.

Pre-Confirmable code permits newly unverified accounts to log in. It is not an
acceptable traffic-serving rollback target without an explicit security decision;
keep maintenance mode until a compatible repair is ready. If a separately approved
rollback restores the old JWT transport, set a **new explicit
`DEVISE_JWT_SECRET_KEY`** before starting any old API replica, and roll back the web
bundle together. The old implementation falls back to `secret_key_base` when that
variable is unset, so unsetting it can revive pre-cutover JWTs. Rotating the cookie
secret alone is insufficient. Drain old sockets and force fresh login. Do not
weaken verification, CSRF or origins to make rollback easier.

## Local review from the retained integration checkout

Use the retained integration checkout after the candidate has been integrated:
`/home/jarrod/Desktop/resume_project/.worktrees/user-login-signup`. Before integration,
the coordinator can point `AUTH_REVIEW_ROOT` below at the retained ticket checkout
instead. Confirm the reviewed commit with `git -C "$AUTH_REVIEW_ROOT" rev-parse HEAD`.
The overlay needs Docker Compose 2.24.4+ (`!override`/`!reset`). These commands use a
separate project/volumes and loopback IP; ports alone would share browser cookies
with other localhost stacks. Do not replace the project with the main stack name.

```bash
export AUTH_REVIEW_ROOT=/home/jarrod/Desktop/resume_project/.worktrees/user-login-signup
export AUTH_REVIEW_PROJECT=cg-auth-human-qa
# Define once in this shell; all subsequent commands use absolute compose paths.
auth_review() {
  docker compose --project-directory "$AUTH_REVIEW_ROOT" -p "$AUTH_REVIEW_PROJECT" \
    -f "$AUTH_REVIEW_ROOT/docker-compose.yml" \
    -f "$AUTH_REVIEW_ROOT/infra/compose.auth-review.yml" "$@"
}
auth_review config --quiet
auth_review build api web
auth_review run --rm api bin/rails db:prepare
auth_review up -d api web
```

Open `http://127.0.0.5:5179`. API uses `http://127.0.0.5:3005`; neither is production
HTTPS. No AI worker or paid/provider call starts. A resume upload is stored and
queued but will remain pending without an AI worker. Development account mail is
written to `services/api/tmp/mails` in this checkout; open the latest file privately
and follow the actual fragment link. Synthetic previews are at
`http://127.0.0.5:3005/rails/mailers/account_mailer/confirmation_instructions` and
`http://127.0.0.5:3005/rails/mailers/account_mailer/reset_password_instructions`.
Previews use fake tokens and cannot verify an account. Preflight intentionally
requires production SMTP configuration and does not pass with local file delivery.

Run tests independently of the development DB:

```bash
auth_review run --rm -e RAILS_ENV=test api bin/rails db:prepare
auth_review run --rm api bundle exec rspec
auth_review run --rm --no-deps web npm test -- --maxWorkers=1
auth_review run --rm --no-deps web npm run typecheck
auth_review run --rm --no-deps web npm run lint
auth_review run --rm --no-deps api bundle exec rubocop
auth_review run --rm --no-deps api bundle exec brakeman --no-pager
auth_review run --rm --no-deps api bundle exec bundler-audit check --update
auth_review run --rm --no-deps web npm audit
auth_review run --rm --no-deps web npm audit --omit=dev
```

Human QA (use two independent browser profiles plus two tabs of one profile):

- Register; try 14 characters, a common eligible password, a Unicode value over 72 bytes
  and an acceptable passphrase. Check paste/autofill, Show/Hide, keyboard labels,
  pending/double-submit, error association, narrow/mobile layout and focus.
- Before verification, sign-in fails generically and protected refresh/upload/live
  access fails. Duplicate signup/resend/recovery show generic notices. Inspect a
  local mail privately, confirm, then sign in. Reused or superseded links fail;
  reopening/refreshing a captured-token page explains how to request another link.
  The token fragment disappears immediately; no auth credential enters localStorage.
- Save distinct job data for accounts A/B. Refresh a protected route, logout and
  sign in as B; A's records and cached pages must disappear, including back/forward.
  A sibling tab should rebootstrap after a session transition. Network failure on
  bootstrap offers retry and does not flash protected data; logout failure stays
  visible and offers retry. Disconnect networking only in the review profile.
- Upload a small valid PDF/DOCX; it queues for the signed-in owner. Invalid/oversized
  files show errors. With browser network tools inspect credentialed multipart and
  CSRF (do not copy cookie/token values). Protected HTTP without CSRF and hostile
  origins are covered by executable specs below, not by disabling security locally.
- Request recovery, resend and use the newest local link. Wrong/mismatched/weak
  replacement passwords fail; correct reset works once. Test signed-in current-
  password change with wrong then correct current password. Old passwords fail;
  every old browser session loses HTTP/private updates and must sign in again.
  Resetting A from a browser signed in as B must not switch B's identity.
- Leave a live task subscription open, then logout/reset/change from the other
  profile; inspect that the old socket stops private delivery and closes on its
  heartbeat. Automated channel specs also cover attempted delivery immediately
  after invalidation. Do not enable paid AI just for this review.
- Exercise a controlled auth 429 and Retry-After/retry after the window. Restore
  normal state afterward. Absolute server expiry, token expiry and concurrent
  consumption have time-controlled/concurrent API specs; local QA need not wait a day.

Stop only this review project, retaining data for another pass:

```bash
auth_review down
```

After human QA is complete, `auth_review down --volumes` deliberately deletes this
review project's test/dev DB, bundle and cache volumes. Delete sensitive local mail
files privately. Never use that command against the main or production project.

# Browser authentication

Devise owns account identity and password checks. Rails owns browser sessions,
CSRF tokens, and cookies. The web app never receives a session credential in JSON
and never stores one in localStorage.

## Session transport

`GET /auth/session` returns safe account fields, or `user: null`, plus a Rails
`csrfToken`. It is also the startup check when the browser refreshes. A network
failure is retryable and does not establish an authenticated session.

Authenticated bootstrap and sign-in also return `taskOutcomeCursor`, a non-secret
owner-scoped task-outcome watermark captured before the workspace becomes usable.
Notifications use it to recover fast completions before their first subscription
handshake without replaying historical outcomes on first use.

Auth calls and GraphQL requests include browser credentials. Unsafe requests send
`X-CSRF-Token`, including login, signup, logout, and multipart uploads. Sign-in
returns safe account state and a fresh CSRF token; signup requests verification
without signing in. Authenticated HTTP work
uses Devise's `current_user`; domain reads/writes remain scoped to that user.
Responses containing session state are not cacheable.

Each successful session transition replaces the Apollo cache and closes the old
socket. A BroadcastChannel sends only a change notification to other browser tabs;
they discard their old session view and bootstrap again before rendering routes.
An outdated bootstrap response cannot restore the previous account.

The session store is Rails-maintained `activerecord-session_store` 2.3.0 with JSON
serialization and `secure_session_only`. It stores opaque session IDs as private
digests in the primary database, rather than accepting browser-supplied account
state. This uses the library's standard store and Devise's session serialization;
there is no separate token protocol. The dependency's tagged constraints support
the app's Rails/Rack versions; app request and connection tests verify integration.

The `_careergrind_session` cookie is HttpOnly, host scoped, and SameSite Lax.
Production requires Secure cookies and HTTPS. Local HTTP development omits Secure.
The cookie lifetime is one day. A persisted authentication timestamp also enforces
an absolute one-day authentication limit, even when repeated requests extend the
cookie expiry. Session state is rotated on authentication and destroyed on logout.

HTTP and Cable use the shared persisted-session identity service. It checks the
stored authentication time and Devise's serialized user/password salt. `/cable`
uses the browser cookie, not a URL token. The channel checks validity before each
operation and private transmission. The regular Cable heartbeat closes invalid
connections; delivery checks block private updates before that heartbeat runs.

## Origins and deployment

Set `CORS_ORIGINS` to explicit HTTP(S) web origins separated by commas; the default
is `http://localhost:5173`. CORS allows credentials only from those origins. The
same list is used for trusted cross-origin CSRF and Cable checks. Do not use `*`
or disable forgery protection to make a deployment work.

Deploy the web app and API under the same site, such as HTTPS subdomains of the
same domain, or route both through one origin. Separate local ports are same-site.
Unrelated hosting domains are incompatible with the chosen SameSite policy.
Configure HTTPS termination/proxy forwarding consistently with production Rails
SSL settings. Keep application secrets stable across API replicas; keep them out
of committed configuration.

The session table is in the primary Rails database. Restrict database access and
retain existing limited AI-reader grants; the AI worker needs no session access.
The database must be available for authentication. Cache eviction cannot grant
access or silently become a fallback authentication store.

## Cleanup and operations

Session lookup uses a unique session-ID index. Schedule the gem's cleanup task
daily, using a retention period longer than the one-day authentication lifetime:

```bash
docker compose run --rm -e SESSION_DAYS_TRIM_THRESHOLD=2 api bin/rails db:sessions:trim
```

The default cleanup threshold is 30 days. Cleanup bounds stored anonymous and
expired state; it does not replace authentication-time expiry checks. Monitor
session table growth, bootstrap throttling, database errors, and authentication
failures without logging cookies, passwords, or CSRF secrets. A session-store
outage must not grant access. Recover the database, then let the browser retry.

## Cutover and rollback

Apply the additive session migration before deploying the new API and web bundle.
Deploy their transport changes together. Users sign in once again; existing
account IDs, passwords, and saved domain data remain intact. The frontend removes
legacy localStorage JWTs. HTTP bearer tokens and Cable URL tokens no longer grant
access; legacy denylist records can remain in the database during this migration.

If rollback is necessary, roll back web and API together and preserve the additive
session table. A rollback to the old JWT implementation must use a newly rotated
JWT signing secret so pre-cutover tokens cannot regain access. Explicitly configure
that secret; do not fall back to the old `secret_key_base`. This forces fresh login
on rollback as well. Stop/drain existing Cable connections during deployment.
Do not drop accounts, password hashes, or domain data as a rollback step.

## Verification

Request tests cover actual cookie login and logout, CSRF, expiry, replay, trusted
origins, and uploads. Channel tests cover persisted-session identity and blocked
delivery after invalidation. Frontend tests cover bootstrap, credentials, CSRF,
navigation, and per-session cache/connection replacement. Use Docker checks from
[testing](../testing.md). Human browser QA should exercise two accounts, refresh,
logout with a live subscription, an expired session, and a resume upload.

## Email verification and delivery

New accounts require Devise Confirmable verification before login, HTTP access or
Cable access. The additive migration explicitly confirms only the rows present
during migration; it preserves IDs, password hashes and profile data. There is no
confirmed database default for future accounts. Apply this migration before the
new code. Keep the columns on rollback; reverting to code without confirmation
would allow unverified accounts to sign in and requires an explicit rollout decision.

`POST /auth/sign_up` accepts `{ user: { email, password, name } }` and returns a
generic 202 message for valid new/duplicate submissions, with no session. Invalid
fields return 422. Duplicate signup never replaces credentials/profile or rotates
the original token. `POST /auth/confirmation` accepts `{ user: { email } }` and
returns the same 202 for unknown, confirmed and unconfirmed accounts. Email requests
are queued, so SMTP latency/failure cannot disclose account existence. Rack::Attack
bounds signup/resend by IP, resend by normalized email, and verification by IP.
Malformed envelopes return 400; invalid fields return 422. All POSTs require CSRF.

`POST /auth/confirmation/verify` accepts `{ confirmation_token }`, returning 200
on confirmation or generic 422 for malformed, expired, reused or superseded links.
Devise owns tokens and the explicit 24-hour expiry. A user row lock serializes
confirmation and resend. Resend forces Devise's own generator to replace the old
token; even a queued old email cannot verify after a newer resend commits. Success
does not create or switch a session. Login errors do not disclose verification state.

Links use configured `WEB_APP_URL`, never the request Host. The token travels in a
fragment to public `/verify-email`, is captured in memory and removed from history
before app mount/bootstrap, and is sent only by an explicit CSRF-protected POST.
Email scanners cannot consume links through GET. Refresh/cancel loses the in-memory
token: reopen the link or request another. Nothing stores the token in localStorage.

Action Mailer and Devise provide delivery. Development uses the development-only
`letter_opener_web` gem and delivery adapter, with an inbox mounted inside Rails at
`http://localhost:3000/letter_opener`. Messages are saved to
`services/api/tmp/letter_opener` without SMTP or opening a browser inside Docker;
delete captured emails from the inbox after testing. The inbox route is absent
outside development. Synthetic previews are at
`http://localhost:3000/rails/mailers/account_mailer/confirmation_instructions`.
Development and production delivery use Solid Queue in the primary application
database; normal migrations prepare its tables and a supervised `bin/jobs` process
runs alongside the API. See [background jobs](background-jobs.md) for setup and
queue migration. Tests use Rails' test queue/delivery adapters. Monitor queue age
and failed `AccountMailDeliveryJob` records. Each SMTP attempt has 5-second open/read
timeouts, required STARTTLS, and at most three attempts with Rails polynomial backoff.
Resend retries a failed or lost request; duplicates are safe, but the latest requested
link is the usable one. This mail never enters AI/SQS queues or Logfire.

Production email delivery remains setup work. Set `WEB_APP_URL` to the HTTPS web
origin, `MAIL_FROM` to the provider-verified sender, and `SMTP_HOST`, `SMTP_PORT`
(587 or 2525), `SMTP_DOMAIN`, `SMTP_USERNAME`, `SMTP_PASSWORD` through environment
secrets. Run `docker compose run --rm api bin/rails accounts:email_preflight`
in the configured deployment environment. This readiness task rejects missing/invalid
configuration and never connects/sends or prints credentials. After setup, a human
must smoke-test delivery, spam placement and links with a controlled account.

Tokens, passwords, emails, CSRF and cookies are filtered request parameters. Devise
stores raw confirmation tokens; AI-reader column grants exclude all confirmation
columns. Rails mail-body logging is disabled; mail-job arguments are hidden and SMTP
errors are replaced with a fixed message before bounded retries. Queue argument SQL
binds are filtered. Solid Queue bulk INSERTs inline serialized tokens, so Active
Record uses a separate INFO logger even when application debug logging is enabled:
SQL debug output is intentionally unavailable. Do not turn it on against real account
mail queues. Queue rows contain delivery tokens and must stay restricted to Rails;
never export them into diagnostics or AI context. No third-party browser telemetry
currently runs; any future integration must initialize after fragment capture and
must exclude account-request bodies.

## Recovery and password changes

`POST /auth/password` accepts `{ user: { email } }` and returns the same 202 message
for known, unknown and unverified accounts. Only confirmed accounts receive recovery
mail. A valid-looking address is required; malformed envelopes return 400 and invalid
addresses return 422. Failed or lost delivery never changes the password. Requesting
mail again generates a fresh Devise token and supersedes the earlier link, including
an earlier message still waiting in the queue. Recovery does not confirm an account.

`PUT /auth/password` accepts `{ user: { reset_password_token, password,
password_confirmation } }`. A successful reset returns 200; malformed, expired, reused
or superseded links and invalid passwords return 422. Tokens expire after six hours.
Devise Recoverable owns token generation, digest storage, expiry and password saving.
The service locks and reloads the account, rechecks the token and confirmation state,
then calls Devise's instance reset operation. This makes consumption one-use even
when requests race. It does not use Devise's class reset helper, whose lookup and save
are separate operations. Both new password fields must be present and identical.

`PATCH /auth/password/change` requires a signed-in account and accepts only
`{ user: { current_password, password, password_confirmation } }`. It checks current
credentials using Devise `update_with_password` under the same user row lock.
It cannot change the sign-in email, name or another account. Validation errors return
422 and missing/expired authentication returns 401. Failed reset/change leaves the
persisted hash, recovery token, confirmation state and usable sessions unchanged.

Successful reset or change clears the outstanding recovery token and changes the
bcrypt salt. Devise's existing session serialization binds every browser to that salt;
the shared HTTP/Cable resolver rejects all old sessions and captured cookies. A login
that verified old credentials before a concurrent reset cannot revive access: even
if it serializes afterward, its user instance carries the old salt. User row locks
also prevent two changes with the same old password from both succeeding. In-flight
domain work authorized before the change may finish; new requests, channel operations
and private transmissions recheck session validity. Expired rows remain until normal
session cleanup. No automatic login follows either operation.

Public `/forgot-password` and `/reset-password` remain reachable in signed-in browsers.
Recovery links use the trusted `WEB_APP_URL` and a fragment captured/cleared before
bootstrap, just like confirmation. An explicit form submit sends the token by a
CSRF-protected PUT; GET never consumes it. Refresh loses the in-memory token, so reopen
the email or request a new one. A successful reset preserves an unrelated signed-in
account; failed recovery never switches identity. `/account/security` offers the
signed-in current-password form. Success navigates to public `/password-updated`,
refreshes session/Apollo state and broadcasts only a change notice to sibling tabs.
The success notice survives authenticated-route unmount. A change returning 401 clears
local state and offers sign-in again. Network failures allow explicit retry; a lost
success response may require signing in with the new password or requesting a new link.

The existing restricted mail queue, sanitized bounded retries, required STARTTLS,
preflight and production setup apply to recovery mail too. A synthetic preview is at
`http://localhost:3000/rails/mailers/account_mailer/reset_password_instructions`.
No additional dependency or migration is needed: reset digest/timestamp columns already
exist and remain unavailable to the AI reader. Request logs filter tokens and passwords;
mail and SQL logging restrictions above also apply to recovery queue arguments.

Recovery requests are bounded to five per IP and normalized email per hour. Reset
attempts are bounded to ten per IP per minute, and signed-in changes to five per IP
and account per ten minutes. Rails returns JSON 429 with Retry-After. These counters
use the configured Rails cache; deployment must provide a shared supported cache
when running multiple API replicas. They do not replace password or token checks.

Address limits use Rails' parsed parameters, including JSON, form and multipart
bodies and the same query-parameter precedence as controllers. Changing an accepted
encoding cannot create a separate mailbox allowance. Anonymous session bootstrap
GET and HEAD requests share one limit of thirty per IP per minute, because either
method can create persisted session state.

## New passwords

Devise validates newly chosen passwords at the User boundary: at least 15 Unicode
characters, with an explicit maximum of 72 bytes for the installed bcrypt hasher.
Some characters use multiple bytes, so a Unicode passphrase may reach that limit
before 72 characters. The server rejects oversized values; it never trims or
normalizes them. Passphrases need no prescribed mix of character types. Existing
password hashes still authenticate, and profile-only updates do not revalidate
the old password. Replacement passwords use the same rules as registration.

The frontend explains these limits and displays server errors. Its shared
`PasswordInput` supports password-manager autocomplete, paste, and a keyboard
visibility toggle. It deliberately has no native maximum length, which could
silently truncate a pasted password, or client strength estimator.

`devise-uncommon_password` 0.4.9 supplies the offline common-password validation.
Its bundled list derives from SecLists `darkweb2017_top10K.txt`; both projects use
the MIT license. `password_matches = 10_000` checks all bundled entries that fit
Devise's configured length range, including case variants. Passwords never leave
the API for this check. This fixed list is a common-password safeguard, not a
complete or continuously updated collection of breached passwords. Update the
dependency deliberately and rerun policy regressions when refreshing it.

The selected release is tagged `v0.4.9` (commit
`3915117211dfd23def120d069a317c4a9ac1ace6`, released February 2026). Its declared
support covers Ruby >=2.7, Rails >=4.2 and <9, and Devise >=3.5 and <6. Upstream
tests cover rejection, case variants, configurable list length, and profile-only
updates; its CI matrix covers Ruby 3.3 with Rails 7.1, 7.2, and 8.0. Application
request/model tests exercise the actual locked Rails 8.1 / Ruby 3.4 / Devise 5 stack.

Narrow safeguards live beside these validations: a text-value guard around
the extension's validator (0.4.9 otherwise calls `downcase` on nil), and assignment
and login guards because bcrypt hashes eagerly and raises on NUL bytes before
validations. Non-text and NUL values are rejected without calling the hasher;
invalid assigned values are retained only so validation can explain the error.
Normal password assignments and comparisons delegate unchanged to Devise. Tests cover
missing/blank/NUL registration, Unicode byte/character boundaries, unchanged
hashes after invalid updates, non-text credentials, malformed login, and legacy login. These guards do not replace the
library's lookup or cryptography.

## References

- [Rails session stores](https://guides.rubyonrails.org/v8.1/action_controller_overview.html#session-stores)
- [Session store release and source](https://github.com/rails/activerecord-session_store/releases/tag/v2.3.0)
- [Session store configuration and cleanup](https://github.com/rails/activerecord-session_store/tree/v2.3.0)
- [Devise](https://github.com/heartcombo/devise)
- [Offline password validator release source and tests](https://github.com/HCLarsen/devise-uncommon_password/tree/v0.4.9)
- [Validator MIT license](https://github.com/HCLarsen/devise-uncommon_password/blob/v0.4.9/MIT-LICENSE)
- [SecLists source and MIT license](https://github.com/danielmiessler/SecLists)

## Release and audit records

Use the [account rollout and human QA runbook](../operations/authentication-rollout.md)
for coordinated migration/deployment, production delivery setup, rollback and the
cookie-isolated local review stack. The [focused boundary audit](../security/authentication-audit.md)
records inspected paths, executed checks and unresolved tooling/environment limits.

Rate limits identify actions through Rails route recognition, so optional format
URLs such as `.json` share their canonical route allowance. Route recognition is
cached only in the current request; unmatched paths continue to normal routing.

An invalid CSRF request remains rejected with HTTP422 and `code: "invalid_csrf"`.
The browser refreshes safe session/bootstrap state for that explicit failure,
replacing the old Apollo cache and socket. It never replays the rejected write.
This recovers an open tab whose cookie expired while its old CSRF token remained
in memory; normal validation422 responses do not reset session state. A stale
account form is remounted with empty password fields and requires a fresh submit.

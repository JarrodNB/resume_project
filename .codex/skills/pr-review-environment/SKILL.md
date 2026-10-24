---
name: pr-review-environment
description: Run a Careergrind PR review app natively in managed cloud or in isolated local Docker Compose, with development credentials, AI workers, and a copy of the main database so existing accounts and saved work are available.
---

# PR review environment

Before running commands, follow [execution environment guidance](../cloud-runtime.md).
In managed cloud, use its native workflow instead of the Docker-specific steps
below. Docker commands apply only on the local computer.


## Managed cloud review

Use the native hooks in the shared guidance in the PR's isolated cloud workspace.
Preserve normal authentication, provider credentials, and telemetry. Verify API,
frontends, workers, database, queues, and storage; hand off verified forwarded URLs
and absolute start/log/stop commands. Disclose missing functionality and ephemeral
emulator data. Do not use the Docker database-copy helper or require the main local
database. Report available accounts/data; request authorization before importing
local account data into cloud. Preserve existing review data where supported.
The remaining sections apply only to local Docker review.

## Local review

Run the requested PR or branch in its own checkout, Compose project, database volumes,
network, and browser origin. Copy the main local development database on first setup;
use existing credentials rather than making the user sign up or seeding a replacement account.
Start the full normal development app by default, including resume upload/parsing and AI
generation. A narrow feature PR does not imply a limited environment. Use a reduced/offline
stack only when the user requests it or a concrete blocker prevents the full app; disclose
the missing behavior and resolve the blocker before claiming the environment is ready.
This workflow does not merge, deploy, or perform browser QA.

## Select and inspect

- Resolve the PR/branch and retained worktree from the chat and attached artifacts. Attach a
  requested PR if needed. Reuse the matching worktree; otherwise use the managed worktree
  tools. Do not reset unrelated files or switch the main checkout to the PR.
- Read applicable AGENTS and the target Compose/configuration files. Resolve the primary
  checkout with `git worktree list --porcelain`. Inspect existing containers, mounts,
  networks, images, and host routes before allocating anything.
- Keep state below the primary checkout's ignored `docs/plans/pr-review-<id>/` (or an
  existing feature plan). Verify with `git check-ignore`. Record source/target commits,
  Compose project, ports, subnet, volumes, database snapshot time, and control commands.
  Do not commit runtime configuration, dumps, credentials, or review data to the product PR.

## Isolate and configure

- Use a unique project such as `cg-pr-99`. Bind web/API only to an unused loopback address
  and ports, e.g. `127.0.0.9:5183` / `127.0.0.9:3009`. A different hostname, not just a
  different port, isolates cookies. Set VITE_API_URL, CORS_ORIGINS, WEB_APP_URL and applicable
  WebSocket/media origins consistently. Preserve an existing review's address on restart.
- Generate a local Compose override. Use `ports: !reset []` for db/SQS/S3 and `!override`
  for the explicit web/API bindings. If Docker's default pools are exhausted, inspect all
  Docker subnets and host routes, then specify a non-overlapping small subnet; do not prune
  unrelated networks. Validate the merged Compose configuration without printing secrets.
- Use separate project-scoped volumes. Never attach the main PostgreSQL volume to a running
  review database or point a review API at the main DB. Named dependency volumes and images
  must match the target lockfiles; build unique images or install dependencies in the review
  volume. Do not modify the main stack's images or dependency volumes.
- Reference the main checkout's existing **development** env files privately for API,
  result consumer and AI services, or provide their required development values through an
  ignored restricted env file. Preserve model/screening configuration. Do not print secrets,
  commit them, use production credentials, or silently blank keys required for normal app
  behavior. Override database/queue/storage endpoints and browser origins to the isolated
  stack regardless of env-file defaults. Do not disable embeddings while enabling import.
- Start all normal Compose services: `db`, `sqs`, `s3`, `api`, `api-results-worker`, `ai`,
  `web`, and `landing` when present. Allocate landing its own loopback port too. Enable the
  same feature flags/profiles as the main development app; if an enabled feature needs a
  separate runtime (such as real interviews), configure/start that runtime and its internal
  secret/origins. Do not enable unrelated experimental flags just because a profile exists.
- Normal resume parsing/generation sends data to the configured providers and incurs normal
  usage costs. Honor authorization already given in the session; do not repeatedly request
  it. If approval review requires explicit provider/destination authorization, explain the
  specific blocker and obtain it once, then complete startup. Never describe a workerless
  stack as the full app. Preserve the main development telemetry setup too: pass through its
  Logfire token and exporter configuration privately, and use a recognizable review service/
  environment label where supported. Do not blank LOGFIRE_TOKEN, disable remote export,
  logging, tracing, embeddings, screening, or other normal functionality unless the user
  requests that limitation. Report a missing development credential as a setup blocker,
  rather than silently treating the disabled subsystem as a complete setup.
- Keep AI and result workers stopped **during initial DB copying**. After copying, identify
  copied in-flight AI/interview operations before starting consumers. Do not republish stale
  operations from main into the new queues. New review uploads/jobs must flow through the
  review's own queues and workers. Existing queued work submitted in this review should run.

## Copy the main development database

1. Identify the actual main Compose project and DB volume; the usual project is
   `resume_project`, volume `resume_project_db_data`, database `api_development`. Verify these
   against metadata, not container naming alone. If the main DB is stopped, start only its
   `db` service with the primary checkout's explicit Compose path. Do not start the main API
   or migrate the source. Record whether the source was already running.
2. Start only the review DB (plus infrastructure if useful), wait for readiness, and verify
   source/target use separate named volumes and compatible Postgres/pgvector versions.
   Stop review API/workers before copying. On first setup, the destination should be empty.
3. Run the bundled [copy-development-db.sh](scripts/copy-development-db.sh) on the host;
   it uses PostgreSQL tools inside Docker, reads only the source development DB, and writes
   only to a `cg-pr-*` target project. Example, with observed container names:

   ```bash
   bash <absolute-skill-path>/scripts/copy-development-db.sh \
     --source-container resume_project-db-1 \
     --source-project resume_project \
     --target-container cg-pr-99-db-1 \
     --target-project cg-pr-99 \
     --state-dir <primary-checkout>/docs/plans/pr-review-99
   ```

   Keep account data/dumps local, ignored, and access-restricted. The script removes its
   temporary source dump and preserves a restricted backup before replacing existing review
   data. Do not print row contents, password hashes, connection secrets, or dump contents.
4. Preserve an existing review database on restart. Refresh only when the user asks to
   recopy main data or has otherwise authorized replacing review changes. Then pass
   `--replace-review-db`; tell the user this replaces review edits, never main data. A failed
   restore stops setup; report the backup path and repair the review DB before starting API.
   Do not loop destructive refreshes or silently reseed a new account.
5. Copy only `api_development`. Create/migrate fresh review cable/cache/queue databases as
   required by the checked-out branch. Do not clone pending queue delivery state. Start the
   review API so its normal `db:prepare` applies the PR's migrations only to the copy. If the
   main DB schema is newer than the PR, report incompatibility; do not roll back the main DB.
6. Verify counts or existing record IDs without exposing personal data. Existing users,
   passwords, jobs, library entries and saved resumes should be present. Separate cookie
   origins mean one normal sign-in is expected, not another registration. Never reset the
   user's password or confirmation state as a setup shortcut.

Database copies do **not** contain uploaded file bytes. If QA needs resume imports or
interview recordings, separately copy the relevant local S3Mock storage into a distinct
review volume while source/target storage is stopped, using the actual mounted paths and
compatible image. Do not mount the same writable bucket/volume in both stacks. Otherwise
state that stored uploads/media were not copied. Do not treat missing bytes as a reason to
delete copied Active Storage records or change their ownership.

## Start, verify, and hand off

- Start the full normal stack from the review checkout with explicit project/file paths.
  Preserve normal authentication; do not bypass auth or enable public binding. A restart
  wrapper should use `up -d` for the configured app, not an export-only service list.
- Check container health, API `/up`, web HTTP response, and that web assets point at the
  review API. Also verify AI and result consumers stay running, reach the isolated queues/DB/
  storage, and have nonblank required provider credentials without revealing their values.
  Verify Logfire credentials/export configuration are active, inspect startup/export errors,
  and confirm a harmless startup trace reaches the configured backend when possible. Avoid
  sending personal content merely to test telemetry; distinguish configured export from
  confirmed ingestion. Keep the app's existing privacy filters and masking in place.
  Use existing review-submitted work to check processing/completion when available. Do not
  create extra paid tasks solely as a startup smoke test without authorization. Use HTTP/CLI
  checks, not browser automation. Startup is not visual QA.
- Leave the review running when the user asks to test. Give the URL, normal-login guidance,
  copied-data coverage/limits, and absolute copy-paste start/log/stop commands. Keep a local
  wrapper so the user need not navigate or reconstruct Compose flags.
- Stop with the same project's `down`, preserving volumes. Remove review data/dumps or
  worktrees only when requested or after the applicable delivery cleanup authorization.
  Never use global prune, `down -v` on main, or an unqualified database reset.
- If main DB was temporarily started just for copying, stop only that DB after the copy
  when no other consumer has started using it; leave previously running source services alone.

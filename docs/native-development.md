# Native development in Codex cloud

This optional setup avoids Docker's VFS layer copies. Docker Compose remains the
default development environment. The native script targets Debian 13 on Linux;
Ubuntu also needs a configured PostgreSQL package repository providing PostgreSQL
17 and pgvector. It does not change Docker or import existing Docker data.

## Setup

On a fresh Codex cloud container, run this as the normal workspace user. It
downloads build prerequisites and compiles PostgreSQL 17, pgvector, and Ruby
under the ignored `.native/` directory, then installs the application:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /workspace/resume_project
bash script/install-native-cloud.sh
```

The installer is safe to rerun and requires no root access. It targets Debian
13 (trixie), needs at least 5 GiB of free disk space during compilation, and downloads from
`deb.debian.org`, `ftp.postgresql.org`, `github.com`, and the application package
registries. Build logs are in `.native/logs/`. A fresh container has no `.native`
directory, so running `python3 script/native.py install` alone is insufficient.

After installation, use:

```bash
python3 script/native.py doctor
python3 -m unittest discover -s script -p test_native.py -v
bash script/start-native-cloud.sh
python3 script/native.py check
python3 script/native.py stop
```

Use `bash script/start-native-cloud.sh` as the cloud **start hook**. It returns
success when this checkout's services are already healthy and restarts a partial
stack before checking it again. Run the install hook before the start hook in a
new container. A restart clears Moto's in-memory queues and uploads.

`system-deps` remains available for hosts where root can install system
packages. The app's own PostgreSQL cluster runs on port **55432**. `doctor` is
read-only and lists missing programs.

Install **Node 22 or newer**, npm, **uv**, and Python 3.9 or newer before running
the script. The cloud runtime normally provides these. `install` builds Ruby
3.4.11 with ruby-build, installs the lockfile's Bundler, installs gems, asks uv for
Python 3.13 and frozen AI dependencies, checks the spaCy model, installs Moto
5.1.14, and runs npm ci for both apps. ruby-build is fetched from its current
upstream default branch; application dependencies use the existing lockfiles.
Allow several minutes and multiple GiB for dependency installation and compilation.

Local Ruby, gems, PostgreSQL data, credentials, and process logs live under the
ignored `.native/` directory. Python's application environment is in
`services/ai/.venv`; Node dependencies stay in each app's `node_modules`.
Rerunning install preserves existing service `.env` files and database data.
It never starts the application. Stop services before reinstalling dependencies.

## Credentials and cloud access

The script copies `.env.example` only when a service `.env` does not exist.
Inherited cloud environment variables take precedence over dotenv files. It
does not print or copy cloud API keys. Native connection settings override
Compose hostnames, and one generated internal interview secret is shared by
Rails and Python. A separate generated MCP signing secret is shared by the AI HTTP
runtime and the MCP tool server. Existing installations gain this secret automatically
without rotating other credentials. Private generated credentials are saved with mode 0600.

The launcher starts the read-only MCP tool server on `127.0.0.1:8001` before the AI
HTTP runtime and points chat at its local `/mcp` endpoint. It uses the same `ai_reader`
database credentials as the AI workers.

For a cloud preview, set these before **start**:

```bash
export NATIVE_WEB_ORIGIN=https://your-web-preview.example
export NATIVE_API_ORIGIN=https://your-api-preview.example
export NATIVE_STORAGE_ORIGIN=https://your-storage-preview.example
```

These configure frontend API URLs, Rails CORS/email links, interview origins,
browser audio storage URLs, and Rails/Vite development host allowances.
Publish/forward ports 5173, 3000, and 9090 through
your environment's supported mechanism. Microphone access requires HTTPS or
localhost. Port 5174 serves the optional landing page. Rails, web, landing, and
the AI HTTP server bind to all interfaces; the database and emulator bind to
loopback. Do not expose the unauthenticated emulator publicly beyond your trusted
development preview.

The inherited session proxy and CA trust remain enabled. Native setup does not
remove network restrictions: package downloads need allowed package hosts;
OpenAI, TypeSafe, telemetry, and job-search requests need their respective
destinations allowed separately. No setup/check command invokes paid AI work.
Once workers run, queued work or user actions can invoke configured providers.

## Differences from Compose

Optional future streaming features use `AI_STREAMING_ENABLED=true` exported before
install/start. Native setup then installs Redis under `.native/bin` if needed and
manages its loopback port 56379. An explicit external `AI_STREAM_REDIS_URL` is preserved
and starts no local buffer. The default final-result interview setup needs no Redis;
see [optional streaming](architecture/ai-streaming.md) for its separate output capability
on the same executor and protocol/latency checks.

- **Moto replaces ElasticMQ and S3Mock**, serving SQS and S3 at
  `http://127.0.0.1:9090`. Queue visibility times, dead-letter queues, and the
  uploads bucket are created before workers start. This is a development
  approximation; emulator behavior may differ from AWS and Compose.
- **Moto storage is in memory.** Stopping/restarting loses uploaded files and
  queued messages. PostgreSQL persists, so old upload records may point to missing
  objects after restart. Re-upload fixtures; do not use important documents here.
  A persistent S3 service is needed if durable uploads are required.
- PostgreSQL uses an isolated local cluster, generated development passwords,
  and the same read-only AI role/grant task as Compose. Rails prepares its primary
  and cable databases before any application worker starts. Its `db:prepare` step also idempotently adopts
  saved legacy interview delivery/watchdogs through `interviews:adopt_delivery`,
  without nudging the HTTP process before it starts. Solid Queue tables live
  in the primary database; the `jobs` process runs `bundle exec ruby bin/jobs` for
  durable Rails background work and scheduled maintenance. Its log is
  `.native/logs/jobs.log`.
- Services run as background process groups, with logs in `.native/logs`.
  `stop` targets this checkout's recorded process groups and PostgreSQL cluster.
  There is no automatic restart policy; inspect logs and restart after crashes.
  Stale PID files are checked conservatively; verify processes before manually
  removing stale files. Do not move the checkout while services are running.
- The frontend's Docker-only example-resume mount is unavailable. Upload a
  repository example manually to test resume import.

`check` checks Rails health, MCP health, both frontend HTTP endpoints, local database,
emulator and AI HTTP ports, and the recorded jobs-supervisor process identity.
It does not validate every job delivery, product flow, provider
credential, subscription, or browser audio path. Inspect worker logs as well.

Durable jobs survive application/worker restarts because PostgreSQL persists their
queue records. This does not make Moto's uploads or SQS messages persistent. See
[Rails background jobs](architecture/background-jobs.md) for the transaction
contract, operation commands, and safe migration from a separate production queue.

For syntax and basic command checks without installing anything:

```bash
python3 -m py_compile script/native.py
python3 script/native.py --help
python3 script/native.py doctor
python3 -m unittest discover -s script -p test_native.py -v
```

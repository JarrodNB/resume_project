# Native development in Codex cloud

This optional setup avoids Docker's VFS layer copies. Docker Compose remains the
default development environment. The native script targets Debian 13 on Linux;
Ubuntu also needs a configured PostgreSQL package repository providing PostgreSQL
17 and pgvector. It does not change Docker or import existing Docker data.

## Setup

Run from the repository root. Use a normal, non-root account for installation and
services. System packages require root once:

```bash
# Run this step as root, or ask your environment administrator to install the packages.
python3 script/native.py system-deps

# Run these steps as your normal account.
python3 script/native.py doctor
python3 script/native.py install
python3 script/native.py start
python3 script/native.py check
python3 script/native.py stop
```

`system-deps` uses apt to install a compiler, Ruby build libraries, PostgreSQL 17,
pgvector, libpq, and FFmpeg. Package installation can start the distribution's
PostgreSQL service; the app uses its own cluster on port **55432**. No sudo helper
or privilege escalation is built into the script. If your managed environment
does not provide root access, missing system packages need an administrator or a
different environment. `doctor` is read-only and lists missing programs.

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
Rails and Python. Private generated credentials are saved with mode 0600.

For a cloud preview, set these before **start**:

```bash
export NATIVE_WEB_ORIGIN=https://your-web-preview.example
export NATIVE_API_ORIGIN=https://your-api-preview.example
export NATIVE_STORAGE_ORIGIN=https://your-storage-preview.example
```

These configure frontend API URLs, Rails CORS/email links, interview origins,
and browser audio storage URLs. Publish/forward ports 5173, 3000, and 9090 through
your environment's supported mechanism. Microphone access requires HTTPS or
localhost. Port 5174 serves the optional landing page. Rails, web, landing, and
the interview server bind to all interfaces; the database and emulator bind to
loopback. Do not expose the unauthenticated emulator publicly beyond your trusted
development preview.

The inherited session proxy and CA trust remain enabled. Native setup does not
remove network restrictions: package downloads need allowed package hosts;
OpenAI, TypeSafe, telemetry, and job-search requests need their respective
destinations allowed separately. No setup/check command invokes paid AI work.
Once workers run, queued work or user actions can invoke configured providers.

## Differences from Compose

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
  and cable databases before any application worker starts.
- Services run as background process groups, with logs in `.native/logs`.
  `stop` targets this checkout's recorded process groups and PostgreSQL cluster.
  There is no automatic restart policy; inspect logs and restart after crashes.
  Stale PID files are checked conservatively; verify processes before manually
  removing stale files. Do not move the checkout while services are running.
- The frontend's Docker-only example-resume mount is unavailable. Upload a
  repository example manually to test resume import.

`check` checks Rails health, both frontend HTTP endpoints, and local database,
emulator, and interview ports. It does not validate every product flow, provider
credential, subscription, or browser audio path. Inspect worker logs as well.

For syntax and basic command checks without installing anything:

```bash
python3 -m py_compile script/native.py
python3 script/native.py --help
python3 script/native.py doctor
```

# Native development in Claude cloud

This is the setup for Claude Code cloud sessions (claude.ai/code). It is separate from the
Codex cloud setup in [native-development.md](native-development.md), which expects Debian 13,
a non-root user and open download hosts. Claude cloud sessions run as root on Ubuntu, and
their network only allows a short list of hosts, so the Codex installer cannot run there.
Both setups run the same stack through `script/native.py`.

## What is different

- **PostgreSQL 17, pgvector and Ruby come from conda-forge**, installed into `.native/conda`
  by micromamba. `.native/pgsql` and `.native/ruby` are symlinks to it, which is where
  `native.py` looks.
- **Ruby is 3.4.13**, not the 3.4.11 in `.ruby-version`. conda-forge does not publish 3.4.11.
  `script/claude_cloud.py` overrides the version check; nothing else about Ruby changes.
- **Gem compiler names are shimmed.** conda's Ruby asks for `x86_64-conda-linux-gnu-cc` and
  friends. The installer links those names to the system compiler in `.native/bin`.
- **The stack runs as the `claude` user.** PostgreSQL refuses to run as root, so the scripts
  hand the checkout to `claude` and run everything through `runuser`. Because of that, the
  checkout's files are owned by `claude` after install.
- **The proxy CA bundle and `uv` are copied** to places the `claude` user can read, since
  `/root` is private.

## Setup

Run as root, once per new container (several minutes):

```bash
bash script/install-claude-cloud.sh
```

Then start, check and stop:

```bash
bash script/start-claude-cloud.sh
runuser -u claude -- env HOME=$PWD/.native/home PATH="$PATH" python3 script/claude_cloud.py check
runuser -u claude -- env HOME=$PWD/.native/home PATH="$PATH" python3 script/claude_cloud.py stop
```

The environment's setup script runs `git fetch origin develop` before installing, then
fast-forwards the checkout to `origin/develop` when the checkout has no commits of its own.
A new session therefore starts at the latest `develop`. Still fetch at the start of each task
(see the root `AGENTS.md`), because `develop` can move during a session.

Logs are in `.native/logs/`. Everything else (Moto instead of ElasticMQ and S3, in-memory
uploads, ports, credentials, previews) works as described in `native-development.md`.

## Network hosts the environment must allow

Package registries (npm, PyPI, rubygems, conda-forge) work by default. The Claude cloud
environment also needs these added to its allowed hosts, for the AI service's CPU PyTorch
wheels and the spaCy model:

- `download.pytorch.org`
- `download-r2.pytorch.org`
- `github.com`
- `release-assets.githubusercontent.com`
- `objects.githubusercontent.com`

OpenAI and other provider hosts are separate and are only needed to run paid AI work.

## Provider keys

Save each key as a network secret on the environment and put a placeholder such as
`proxy-injected` in the matching `.env` variable; the proxy swaps in the real key on requests
to that host. Domains: `api.openai.com`, `api.typesafe.ai`, `api.cleanjobdata.com`,
`api.stripe.com`. `native.py` only gives the Python services their `.env` file, so
`claude_cloud.py` also copies the Rails provider keys from `services/api/.env` into Rails'
environment (see `RAILS_PROVIDER_SETTINGS`). Stripe's webhook secret is not an outbound
credential, so the proxy cannot supply it.

## Find jobs and the session proxy

`SearchCleanJobDataService` ignores general proxy variables on purpose, so on its own it cannot
reach CleanJobData from here, where all traffic must use the proxy. Once the
`CLEANJOBDATA_PROXY_URL` setting is in the app (PR #464), `claude_cloud.py` points it at the
session proxy and Find jobs works. Without that setting the search fails with a DNS error even
with a valid key.

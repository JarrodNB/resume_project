"""Run the native development stack inside Claude cloud (claude.ai/code) sessions.

This is the Claude cloud counterpart to the Codex cloud setup in `native.py`. It reuses
all of `native.py` (database, emulators, Rails, AI workers, web), and only changes what
Claude cloud needs: PostgreSQL 17, pgvector and Ruby come from a conda-forge environment
at `.native/conda` (the usual download hosts are blocked there). It also passes the provider
keys in `services/api/.env` to Rails, which `native.py` does not, and it expects Ruby 3.4.13
instead of the 3.4.11 that `.ruby-version` names. It must run as a normal user, not root;
`install-claude-cloud.sh` and `start-claude-cloud.sh` take care of that.

Usage: python3 script/claude_cloud.py {install,start,stop,check,doctor}
"""

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import native  # noqa: E402

CLAUDE_CLOUD_RUBY = "3.4.13"  # newest 3.4 patch on conda-forge; 3.4.11 is not published there.


def trust_proxy_certificates():
    """Point Python, Node, curl and git at a readable copy of the session's CA bundle."""
    bundle = native.STATE / "ca-bundle.crt"
    if not bundle.is_file():
        return
    for name in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
                 "CURL_CA_BUNDLE", "GIT_SSL_CAINFO", "NIX_SSL_CERT_FILE"):
        os.environ[name] = str(bundle)


# Rails has no dotenv gem and `native.py` only gives the Python services their `.env` file,
# so these provider settings in `services/api/.env` would never reach Rails. Compose does
# this with `env_file`; here they are copied into the environment before services start.
RAILS_PROVIDER_SETTINGS = ("OPENAI_API_KEY", "CLEANJOBDATA_API_KEY", "STRIPE_SECRET_KEY",
                           "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET")


def load_rails_provider_settings():
    """Copy non-empty provider settings from services/api/.env unless already set."""
    dotenv = native.ROOT / "services/api/.env"
    if not dotenv.is_file():
        return
    for line in dotenv.read_text().splitlines():
        name, separator, value = line.partition("=")
        value = value.strip().strip("'\"")
        if separator and name.strip() in RAILS_PROVIDER_SETTINGS and value:
            os.environ.setdefault(name.strip(), value)


def route_job_search_through_session_proxy():
    """Job search ignores general proxy variables on purpose; give it the session proxy explicitly.

    Needs the CLEANJOBDATA_PROXY_URL setting in Rails. Older code simply ignores it.
    """
    session_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if session_proxy:
        os.environ.setdefault("CLEANJOBDATA_PROXY_URL", session_proxy)


def main():
    commands = {"install": native.install, "start": native.start, "stop": native.stop,
                "check": native.check, "doctor": native.doctor}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        sys.exit(__doc__)
    native.RUBY = CLAUDE_CLOUD_RUBY
    trust_proxy_certificates()
    load_rails_provider_settings()
    route_job_search_through_session_proxy()
    commands[sys.argv[1]]()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Claude cloud setup failed: {error}", file=sys.stderr)
        sys.exit(1)

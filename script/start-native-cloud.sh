#!/usr/bin/env bash
# Start the native development stack after installation, or keep a healthy stack running.
# The cloud start hook may run more than once in the same container.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

if python3 script/native.py check > /dev/null 2>&1; then
  echo 'Native services are already healthy.'
  exit 0
fi

# If a prior run left a partial stack, stop only this checkout's recorded
# processes before starting it again. native.py verifies their identities.
if compgen -G '.native/*.pid' > /dev/null || [[ -f .native/postgres/postmaster.pid ]]; then
  python3 script/native.py stop
fi

python3 script/native.py start

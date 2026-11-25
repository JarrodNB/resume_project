#!/usr/bin/env bash
# Start the native development stack in a Claude cloud (claude.ai/code) session, or
# leave it alone if it is already healthy. Run install-claude-cloud.sh first.
# Run as root; the stack itself runs as the unprivileged `claude` user.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
state="$root/.native"

run_as_claude() {
  runuser -u claude -- env HOME="$state/home" PATH="$PATH" "$@"
}

# A resumed container has no running processes but keeps the PID file PostgreSQL left behind,
# and `stop` fails on it. Remove it only when its recorded process is gone or is not a
# postgres process (process numbers get reused). A live database is never touched.
postmaster_pid_file=".native/postgres/postmaster.pid"
if [[ -f $postmaster_pid_file ]]; then
  recorded_pid=$(head -n 1 "$postmaster_pid_file")
  if [[ $(ps -p "$recorded_pid" -o comm= 2>/dev/null) != postgres ]]; then
    echo "Removing stale PostgreSQL PID file (process $recorded_pid is not running)."
    rm -f "$postmaster_pid_file"
  fi
fi

if run_as_claude python3 script/claude_cloud.py check > /dev/null 2>&1; then
  echo 'Native services are already healthy.'
  exit 0
fi

if compgen -G '.native/*.pid' > /dev/null || [[ -f .native/postgres/postmaster.pid ]]; then
  run_as_claude python3 script/claude_cloud.py stop
fi

run_as_claude python3 script/claude_cloud.py start

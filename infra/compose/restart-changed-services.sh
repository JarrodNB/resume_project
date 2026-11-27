#!/bin/bash
# Restarts the services whose image or config changed, the way a deploy needs it. The deploy
# workflow runs it on the server from /opt/app after pulling the new images (tags exported).
#
# Every service except ai-live goes through a plain `docker compose up -d`. ai-live is different
# because stopping it waits for its running live interviews to end. So when ai-live changed, this
# starts the new ai-live first, waits until it has registered with LiveKit, and only then tells the
# old one to drain: the old one takes no new interviews and exits by itself once its running ones
# end (live_interviews/worker.py caps that at 50 minutes). Nothing waits for it, so the deploy
# finishes right away and new live interviews never go without an interviewer.
#
# A draining container is renamed to <name>-draining-<unix time> and is left alone until it has
# exited; a later run of this script removes it then. While one is draining, do not run a plain
# `docker compose up -d`, `restart` or `down` with ai-live: compose would stop it again, and a
# second stop signal makes the worker exit at once and cut off its interviews.
set -euo pipefail

cd "$(dirname "$0")"

LIVE=ai-live
# How long to wait for the new ai-live to register before giving up and keeping the old one.
LIVE_REGISTER_SECONDS=${LIVE_REGISTER_SECONDS:-120}

# Everything but ai-live. Compose only recreates the services whose image or config changed, and
# leaves ai-live's containers alone because ai-live is still a service in the file.
mapfile -t others < <(docker compose config --services | grep -vx "$LIVE")
docker compose up -d --remove-orphans "${others[@]}"

want=$(docker compose config --hash "$LIVE" | awk '{print $2}')
current=""
stale=()
for id in $(docker compose ps -a -q "$LIVE"); do
  read -r name hash state < <(docker inspect -f '{{.Name}} {{index .Config.Labels "com.docker.compose.config-hash"}} {{.State.Status}}' "$id")
  if [[ "$name" == *-draining-* ]]; then
    # Finished draining: remove it. Still draining: leave it be.
    [ "$state" = running ] || docker rm -f "$id" >/dev/null
  elif [ "$state" != running ] && [ "$state" != restarting ]; then
    # Stopped, so nothing to drain. Compose starts or creates a fresh one below.
    docker rm -f "$id" >/dev/null
  elif [ -z "$current" ] && [ "$hash" = "$want" ]; then
    current=$id
  else
    stale+=("$id")
  fi
done

if [ -z "$current" ]; then
  # Add one container with the new config next to the ones still running. --no-recreate keeps
  # compose from stopping the old ones; the scale counts every ai-live container compose sees.
  count=$(docker compose ps -a -q "$LIVE" | wc -l)
  before=$(docker compose ps -a -q "$LIVE")
  docker compose up -d --no-deps --no-recreate --scale "$LIVE=$((count + 1))" "$LIVE"
  for id in $(docker compose ps -a -q "$LIVE"); do
    grep -qx "$id" <<<"$before" || current=$id
  done
  if [ -z "$current" ]; then
    echo "ai-live: compose did not start a new container" >&2
    exit 1
  fi
fi

[ ${#stale[@]} -gt 0 ] || exit 0

# Only drain the old worker once the new one can take interviews. livekit-agents logs
# "registered worker" when LiveKit accepts its registration (livekit-agents 1.9.0,
# livekit/agents/worker.py, AgentServer._handle_register). Not `docker logs | grep -q`: under
# pipefail, grep quitting at the first match kills docker logs with SIGPIPE and fails the pipe.
registered=""
for _ in $(seq 1 "$LIVE_REGISTER_SECONDS"); do
  if grep -q 'registered worker' < <(docker logs "$current" 2>&1); then
    registered=yes
    break
  fi
  sleep 1
done
if [ -z "$registered" ]; then
  echo "ai-live: the new worker did not register with LiveKit within ${LIVE_REGISTER_SECONDS}s; the old one keeps running" >&2
  docker logs --tail 50 "$current" >&2 || true
  exit 1
fi

for id in "${stale[@]}"; do
  name=$(docker inspect -f '{{.Name}}' "$id")
  docker rename "$id" "${name#/}-draining-$(date +%s)"
  # Without this, the restart policy would start it again once it exits.
  docker update --restart=no "$id" >/dev/null
  # One SIGTERM starts the drain. The worker exits by itself when its interviews end.
  docker kill -s TERM "$id" >/dev/null
  echo "ai-live: ${name#/} is draining its running live interviews"
done

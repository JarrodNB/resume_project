#!/usr/bin/env bash
# Exercise real local services with synthetic provider HTTP, never the paid project.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
run_id="$(date -u +%Y%m%d%H%M%S)-$RANDOM"
project="cg-interview-18-synthetic-$run_id"
compose=(docker compose -p "$project" -f "$root/docs/interview-demo.compose.yml" -f "$root/docs/interview-full-check.compose.yml")
probe="$project-probe"
rails() {
  "${compose[@]}" run --rm --no-deps -e CHECK_RUN_ID="$run_id" -e CHECK_PHASE="$1" -e CHECK_CASE="${case_name:-fault-turn}" -e CHECK_HISTORY_SHA="${history_sha:-}" api bundle exec rails runner script/interview_full_session_check.rb
}
cleanup() { docker rm -f "$probe" >/dev/null 2>&1 || true; "${compose[@]}" stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${compose[@]}" up -d db s3
"${compose[@]}" run --rm api bundle exec rails db:prepare
"${compose[@]}" up -d --no-build --wait api interview-runtime
"${compose[@]}" run --rm --no-deps storage-setup
"${compose[@]}" stop interview-runtime
start_probe() {
  "${compose[@]}" run -d --no-deps --name "$probe" -e CHECK_OPERATION_ID="$operation_id" \
    -e CHECK_PAUSE="$1" interview-runtime python -m scripts.interview_full_restart_probe >/dev/null
}
wait_barrier() {
  for ((attempt=0; attempt<150; attempt++)); do
    if docker logs "$probe" 2>&1 | rg -q "BARRIER $1"; then return; fi
    sleep 0.2
  done
  docker logs "$probe"
  return 1
}
kill_probe() {
  docker kill --signal KILL "$probe" >/dev/null
  docker rm "$probe" >/dev/null
}
operation_id=$(rails setup | sed -n 's/^OPERATION_ID=//p')
start_probe before_accept
wait_barrier before_accept
kill_probe
"${compose[@]}" up -d --no-build --wait interview-runtime
rails ready
"${compose[@]}" stop interview-runtime
rails begin
"${compose[@]}" up -d --no-build --wait interview-runtime
rails opening
"${compose[@]}" stop interview-runtime
operation_id=$(rails submit | sed -n 's/^OPERATION_ID=//p')
start_probe lost_receipt
code=$(docker wait "$probe")
docker logs "$probe"
docker rm "$probe" >/dev/null
[[ "$code" == 0 ]]
# The turn committed despite the lost receipt. Its independent speech is still pending.
history_sha=$(rails retry-prepare | sed -n 's/^HISTORY_SHA=//p')
"${compose[@]}" up -d --no-build --wait interview-runtime
rails retry-verify
rails recovered
"${compose[@]}" stop interview-runtime
case_name=after-accept
operation_id=$(rails submit | sed -n 's/^OPERATION_ID=//p')
start_probe after_accept
wait_barrier after_accept
kill_probe
"${compose[@]}" up -d --no-build --wait interview-runtime
rails full
"${compose[@]}" stop interview-runtime
rails abandon-setup
"${compose[@]}" up -d --force-recreate --wait s3
"${compose[@]}" run --rm --no-deps storage-setup
rails storage
printf '%s\n' "PASS full-session mocked-provider process check; synthetic volumes retained; PROJECT=$project CHECK_RUN_ID=$run_id"

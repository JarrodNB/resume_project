#!/usr/bin/env bash
# Kill real offline executors at acceptance boundaries and check durable recovery.
# Uses only the isolated cg-interview-06 stack; retains volumes for inspection.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
compose=(docker compose -p cg-interview-06 -f "$root/docs/interview-demo.compose.yml")
run_id="$(date -u +%Y%m%d%H%M%S)-$RANDOM"
probe="cg-interview-06-probe"
rails() {
  "${compose[@]}" run --rm --no-deps -e CHECK_RUN_ID="$run_id" -e CHECK_PHASE="$1" \
    -e CHECK_CASE="${case_name:-}" -e CHECK_HISTORY_SHA="${history_sha:-}" api bundle exec rails runner script/interview_recovery_check.rb
}
cleanup() {
  result=$?
  docker rm -f "$probe" >/dev/null 2>&1 || true
  "${compose[@]}" stop interview-runtime >/dev/null 2>&1 || true
  if [[ ${fixtures_created:-false} == true && "$result" == 0 ]]; then
    rails cleanup || true
  elif [[ ${fixtures_created:-false} == true ]]; then
    echo "Failed check fixtures retained: CHECK_RUN_ID=$run_id" >&2
    echo "Remove with CHECK_PHASE=cleanup using the Rails driver after inspection." >&2
  fi
}
trap cleanup EXIT
"${compose[@]}" build api interview-runtime
"${compose[@]}" up -d db s3
"${compose[@]}" run --rm api bundle exec rails db:prepare
"${compose[@]}" up -d --wait api
"${compose[@]}" run --rm --no-deps storage-setup
rails setup
fixtures_created=true
"${compose[@]}" up -d --wait interview-runtime
rails opening
"${compose[@]}" stop interview-runtime

start_probe() {
  "${compose[@]}" run -d --no-deps --name "$probe" -e CHECK_OPERATION_ID="$operation_id" \
    -e CHECK_PAUSE="$1" -e INTERVIEW_FAKE_SCENARIO="${scenario:-normal}" \
    interview-runtime python -m scripts.interview_restart_probe >/dev/null
}
wait_barrier() {
  for ((attempt=0; attempt<100; attempt++)); do
    if docker logs "$probe" 2>&1 | rg -q "BARRIER $1"; then return; fi
    sleep 0.2
  done
  docker logs "$probe"
  echo "Executor did not reach $1" >&2
  exit 1
}
finish_probe() {
  code=$(docker wait "$probe")
  docker logs "$probe"
  docker rm "$probe" >/dev/null
  [[ "$code" == 0 ]]
}
operation_id=$(rails submit-first | sed -n 's/^OPERATION_ID=//p')
start_probe before_accept
wait_barrier before_accept
docker kill --signal KILL "$probe" >/dev/null
docker rm "$probe" >/dev/null
"${compose[@]}" up -d --wait interview-runtime
rails verify-first
"${compose[@]}" stop interview-runtime
operation_id=$(rails submit-second | sed -n 's/^OPERATION_ID=//p')
start_probe after_accept
wait_barrier after_accept
docker kill --signal KILL "$probe" >/dev/null
docker rm "$probe" >/dev/null
rails verify-accepted
"${compose[@]}" up -d --wait interview-runtime
rails verify-complete
"${compose[@]}" stop interview-runtime
rails contracts

for case_name in lost-receipt blocked unavailable oversized invalid; do
  operation_id=$(rails prepare-case | sed -n 's/^OPERATION_ID=//p')
  scenario="$case_name"
  pause=none
  if [[ "$case_name" == lost-receipt ]]; then scenario=normal; pause=lost_receipt; fi
  if [[ "$case_name" == invalid ]]; then scenario=normal; fi
  start_probe "$pause"
  finish_probe
  rails verify-case
done
scenario=normal
speech_receipt=$(rails speech-retry)
operation_id=$(sed -n 's/^OPERATION_ID=//p' <<<"$speech_receipt")
history_sha=$(sed -n 's/^HISTORY_SHA=//p' <<<"$speech_receipt")
start_probe none
finish_probe
rails verify-speech
"${compose[@]}" up -d --force-recreate s3
"${compose[@]}" run --rm storage-setup
rails verify-storage
rails retention
echo "PASS real executor kills/restarts, canonical receipt reconciliation and failure scenarios"

#!/usr/bin/env bash
# Run a local provider check using the retained ledger; keep usage records across runs.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${INTERVIEW_VERIFICATION_AI_ENV:?Set the absolute original ignored AI environment file path}"
compose=(docker compose -p cg-interview-12-paid -f "$root/docs/interview-recovery.compose.yml" -f "$root/docs/interview-paid-check.compose.yml")
trap '"${compose[@]}" stop ai-http api-jobs-worker >/dev/null' EXIT
"${compose[@]}" up -d --no-build --wait api-jobs-worker ai-http
"${compose[@]}" run --rm --no-deps api bundle exec rails runner script/interview_paid_check.rb "$@"

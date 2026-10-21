#!/usr/bin/env bash
# Explicit live check: one persistent ledger, no provider retries, always stop execution on exit.
# Do not rerun after unknown usage. The October 21 attempt is unresolved; new human direction is required.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${INTERVIEW_VERIFICATION_AI_ENV:?Set the absolute original ignored AI environment file path}"
: "${INTERVIEW_PAID_CHECK_APPROVED:?Set only after reviewing the existing ledger and pending operations}"
[[ "$INTERVIEW_PAID_CHECK_APPROVED" == yes ]] || exit 1
compose=(docker compose -p cg-interview-12-paid -f "$root/docs/interview-demo.compose.yml" -f "$root/docs/interview-paid-check.compose.yml")
# Prepare db/api/storage separately using the guide. Check BEFORE starting a runtime:
# existing real work would otherwise resume as soon as the process is ready.
"${compose[@]}" run --rm --no-deps api bundle exec rails runner '
  raise "STOP: unresolved paid usage" if InterviewVerificationReservation.where(actual_microdollars: nil).exists?
  raise "STOP: saved real work requires explicit recovery review" if InterviewSessionOperation.joins(:interview_session).where(interview_sessions: {execution_mode: "real"}, status: %w[pending running]).exists?
  puts "Preflight ledger and pending-work checks passed"
'
trap '"${compose[@]}" stop interview-runtime >/dev/null' EXIT
"${compose[@]}" up -d --no-build --wait interview-runtime
"${compose[@]}" run --rm --no-deps api bundle exec rails runner script/interview_paid_check.rb "$@"

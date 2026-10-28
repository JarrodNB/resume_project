#!/usr/bin/env bash
# Start or stop real browser QA against the one retained paid ledger. Credentials
# stay in the original ignored environment file; this script never copies them.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${INTERVIEW_VERIFICATION_AI_ENV:?Set the absolute original ignored AI environment file path}"
[[ "$INTERVIEW_VERIFICATION_AI_ENV" == /* && -f "$INTERVIEW_VERIFICATION_AI_ENV" ]] || { echo "An existing absolute AI environment file is required" >&2; exit 1; }
compose=(docker compose -p cg-interview-12-paid -f "$root/docs/interview-recovery.compose.yml" -f "$root/docs/interview-paid-check.compose.yml" -f "$root/docs/interview-real-qa.compose.yml" --profile qa)
case "${1:-}" in
  start)
    "${compose[@]}" up -d --no-build --wait db s3 sqs api web
    "${compose[@]}" exec -T api bundle exec rails runner '
      raise "Local development only" unless Rails.env.development?
      require Rails.root.join("lib/ai_reader_access")
      connection = ApplicationRecord.connection
      unless AiReaderAccess.role_exists?(connection)
        connection.execute("CREATE ROLE ai_reader LOGIN PASSWORD '\''ai_reader'\''")
      end
      AiReaderAccess.grant(connection)
    '
    "${compose[@]}" up -d --no-build api-jobs-worker api-results-worker ai-worker
    "${compose[@]}" exec -T api bundle exec rails runner '
      raise "Retained paid ledger missing; do not create a replacement allowance" unless InterviewVerificationReservation.exists?
      used = InterviewVerificationReservation.sum("COALESCE(actual_microdollars, reserved_microdollars)")
      puts "Recorded usage or estimates: #{used} microdollars (not a provider hold or invoice total)"
      puts "Recoverable real operations: #{InterviewSessionOperation.joins(:interview_session).where(interview_sessions: { execution_mode: "real" }, status: %w[pending running]).count}"
    '
    "${compose[@]}" run --rm --no-deps storage-setup
    "${compose[@]}" up -d --no-build --wait ai-http
    echo "Real spoken interview: http://127.0.0.2:15176/interviews"
    ;;
  stop) "${compose[@]}" stop ;;
  status) "${compose[@]}" ps ;;
  *) echo "Usage: $0 start|stop|status" >&2; exit 2 ;;
esac

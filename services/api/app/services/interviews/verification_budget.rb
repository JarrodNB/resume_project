# Record conservative cost estimates for each provider call and reconcile them with actual usage.
# This is bookkeeping only: it does not cap or pause spending. Call inside the owner/operation
# transaction; reconciliation takes a shared lock and no provider work runs while it is held.
module Interviews
  module VerificationBudget
    LOCK_ID = 741_009
    # Transcription: 120 seconds at $0.0045/minute. Speech: human-approved $0.25
    # estimate for <=4,000 characters; NOT a proven provider billing ceiling.
    # Token stages use conservative estimates with bounded prompts and 1,024 OpenAI
    # output tokens for dialogue/screening, 4,096 for complete preparation. Actual usage
    # reconciles every dispatch. These are local estimates, not provider charges or holds.
    # Terra covers its 120,000-character prompt cap at one token per character ($0.12)
    # plus 4,096 preparation output tokens ($0.02).
    RESERVATIONS = { %w[transcription openai gpt-transcribe] => 9_000,
      %w[transcription openai gpt-live-transcribe] => 34_000,
      %w[speech openai gpt-4o-mini-tts] => 250_000,
      %w[screening typesafe jev-1.13.0] => 10_000,
      %w[screening openai gpt-5-nano] => 50_000,
      %w[interviewer openai gpt-6-luna] => 50_000,
      %w[interviewer openai gpt-6.1-terra] => 150_000,
      # One live connection: up to 25 counted minutes of gpt-realtime-2.1-mini audio in and out
      # (its context is re-read every reply, mostly as cached input) plus the candidate's input
      # transcription. A deliberately generous US$2.00 estimate, not a provider ceiling.
      %w[live_conversation openai gpt-realtime-2.1-mini] => 2_000_000 }.freeze

    # Records the estimate for one dispatch. It never blocks on other calls' usage:
    # an unresolved or failed call must not stop every user. Per-user allowances still
    # apply separately. Only a model with no registered price is refused.
    def self.reserve(observation_id:, stage:, provider:, model:)
      amount = RESERVATIONS[[ stage, provider, model ]]
      return false unless amount

      InterviewVerificationReservation.create!(observation_id: observation_id, reserved_microdollars: amount)
      true
    end

    def self.reconcile(observation_id:, cost:)
      lock
      reservation = InterviewVerificationReservation.find_by!(observation_id: observation_id)
      reservation.update!(actual_microdollars: cost) unless reservation.actual_microdollars
    end

    # Operator-verified receipts may correct an earlier estimate as well as resolve an unknown.
    def self.reconcile_verified(observation_id:, cost:)
      lock
      InterviewVerificationReservation.find_by!(observation_id: observation_id).update!(actual_microdollars: cost)
    end

    def self.lock
      raise ArgumentError, "Verification accounting requires a transaction" unless ApplicationRecord.connection.transaction_open?

      ApplicationRecord.connection.execute("SELECT pg_advisory_xact_lock(#{LOCK_ID})")
    end
    private_class_method :lock
  end
end

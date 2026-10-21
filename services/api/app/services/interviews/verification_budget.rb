# Reserve conservative costs against one durable $5 verification target.
# Call inside the owner/operation transaction. The shared lock always comes last, and
# no provider or network work runs while it is held. Unknown costs keep their reservation.
module Interviews
  module VerificationBudget
    LIMIT_MICRODOLLARS = 5_000_000
    LOCK_ID = 741_009
    # Transcription: 120 seconds at $0.0045/minute. Speech: human-approved $0.25
    # estimate for <=4,000 characters; NOT a proven provider billing ceiling.
    # Token stages use conservative estimates with bounded prompts and 1,024 OpenAI
    # output tokens. Actual usage reconciles every dispatch; unknown usage stops all.
    RESERVATIONS = { %w[transcription openai gpt-transcribe] => 9_000,
      %w[speech openai gpt-4o-mini-tts] => 250_000,
      %w[screening typesafe jev-1.13.0] => 10_000,
      %w[screening openai gpt-5-nano] => 50_000,
      %w[interviewer openai gpt-6-luna] => 50_000 }.freeze

    def self.reserve(observation_id:, stage:, provider:, model:)
      amount = RESERVATIONS[[ stage, provider, model ]]
      return false unless amount

      lock
      # At most one unresolved paid dispatch globally. This also stops fresh work
      # after a crash, timeout or lost callback, without an unsafe automatic release.
      return false if InterviewVerificationReservation.where(actual_microdollars: nil).exists?

      used = InterviewVerificationReservation.sum("COALESCE(actual_microdollars, reserved_microdollars)")
      return false if used + amount > LIMIT_MICRODOLLARS

      InterviewVerificationReservation.create!(observation_id: observation_id, reserved_microdollars: amount)
      true
    end

    def self.reconcile(observation_id:, cost:)
      lock
      reservation = InterviewVerificationReservation.find_by!(observation_id: observation_id)
      reservation.update!(actual_microdollars: cost) unless reservation.actual_microdollars
    end

    def self.lock
      raise ArgumentError, "Verification accounting requires a transaction" unless ApplicationRecord.connection.transaction_open?

      ApplicationRecord.connection.execute("SELECT pg_advisory_xact_lock(#{LOCK_ID})")
    end
    private_class_method :lock
  end
end

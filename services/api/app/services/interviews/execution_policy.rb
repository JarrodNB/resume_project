# Shares the owner-first lock and lease rules across interview execution services.
# No provider or storage I/O is allowed while these database locks are held.
module Interviews
  module ExecutionPolicy
    LEASE = 30.seconds
    DEADLINE = 120.seconds
    BACKOFF = [ 2, 5, 10 ].freeze
    FAILURE_CODES = %w[dependency_unavailable invalid_recording screening_blocked screening_unavailable execution_failed execution_timeout lease_expired speech_failed].freeze

    private

    def with_operation_lock
      interview = @operation.interview_session
      interview.user.with_lock(requires_new: true) do
        interview.lock!
        interview.questions.order(:position).lock.load
        @operation.lock!
        @operation.ai_task&.lock!
        yield interview
      end
    end

    def current_claim?
      @operation.running? && @attempt_id.present? && @attempt_id == @operation.attempt_id &&
        @generation == @operation.claim_generation && @operation.lease_expires_at > Time.current &&
        @operation.execution_deadline > Time.current
    end

    def expire_operation(interview)
      return false unless @operation.pending? || @operation.running? || @operation.failed?

      expiry = @operation.turn? ? @operation.created_at + 1.hour : (interview.completed_at ? interview.completed_at + 1.hour : interview.expires_at)
      expired = interview.expires_at <= Time.current || interview.expired? || expiry <= Time.current ||
        (@operation.retry_expires_at && @operation.retry_expires_at <= Time.current)
      return false unless expired

      @operation.update!(status: "expired", retry_at: nil, failure_code: "media_expired")
      @operation.ai_task&.update!(status: "failed", error_message: "media_expired", completed_at: Time.current)
      true
    end

    def fail_execution(code, retryable:)
      automatic = retryable && @operation.cycle_execution_count < 3 && @operation.execution_count < 6 &&
        @operation.retry_expires_at > Time.current
      @operation.update!(status: automatic ? "pending" : "failed", failure_code: code,
        retry_at: automatic ? Time.current + BACKOFF.fetch(@operation.cycle_execution_count - 1).seconds : nil)
      @operation.ai_task&.update!(status: automatic ? "queued" : "failed", completed_at: automatic ? nil : Time.current,
        error_message: code)
    end
  end
end

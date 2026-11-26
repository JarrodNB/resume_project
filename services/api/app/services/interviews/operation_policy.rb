# What is specific to interviews when the shared operation lifecycle runs an interview operation.
#
# The shared rules (leases, fencing, retry budgets, recovery) live in
# `AiExecutions::OperationLifecycle`. This file says: the interview session is the lock
# owner (and its questions are locked too), which failure codes are final, which
# checkpoints exist, when an expired or abandoned interview stops work, and how
# recording expiry follows a final failure.
module Interviews
  class OperationPolicy < AiExecutions::OperationPolicy
    FAILURE_CODES = %w[ai_usage_limit_reached plan_ended dependency_unavailable storage_unavailable invalid_recording transcript_too_long empty_audio audio_too_large audio_too_long context_limit screening_blocked screening_unavailable execution_failed execution_timeout lease_expired speech_failed].freeze
    NON_RETRYABLE_CODES = %w[invalid_recording transcript_too_long empty_audio audio_too_large audio_too_long context_limit screening_blocked].freeze
    CHECKPOINTS = %w[recording_validated transcribed screened interviewer_finished speech_started].freeze

    def feature = "interviews"

    def owner = operation.interview_session

    def lock_owner_records(interview)
      interview.questions.order(:position).lock.load
    end

    def failure_codes = FAILURE_CODES

    def non_retryable_codes = NON_RETRYABLE_CODES

    def checkpoints = CHECKPOINTS

    def claim_allowed?
      interview = owner
      !interview.abandoned? && !interview.expired? && interview.expires_at > Time.current
    end

    # Accepted results are final. Failure receipts still require an unexpired lease so
    # recovery after actual lease/deadline loss keeps stopping work.
    def finished_state?
      operation.accepted? ||
        ((operation.failed? || (operation.pending? && operation.failure_code.present?)) &&
          operation.lease_expires_at > Time.current && operation.execution_deadline > Time.current)
    end

    # Heartbeats that carry a checkpoint are never finished receipts.
    def receipt_allowed?(attempt_id:, checkpoint:)
      attempt_id.present? && !checkpoint && claim_allowed?
    end

    # A claim that finds an overdue attempt reports the deadline as a timeout.
    def stale_claim_code = (operation.execution_deadline <= Time.current ? "execution_timeout" : "lease_expired")

    def invalid_failure_message = "Invalid failure"

    def failure_report = { status: operation.status, failure_code: operation.failure_code, retry_at: operation.retry_at }

    # The moment past which this operation's media or session no longer allows work.
    def work_expiry
      interview = owner
      if operation.text_only?
        [ operation.created_at + 1.hour, interview.expires_at ].min
      elsif operation.turn? || operation.transcription?
        InterviewSessionMedia.find_by(id: operation.recording_id, interview_session_id: interview.id, kind: "recording")&.expires_at || Time.current
      else
        interview.completed_at ? interview.completed_at + 1.hour : interview.expires_at
      end
    end

    def expire_if_due?
      interview = owner
      return false unless operation.pending? || operation.running? || operation.failed?

      stale_capture = operation.transcription? && (!interview.active? || operation.expected_revision != interview.revision)
      expired = stale_capture || interview.expires_at <= Time.current || interview.expired? || work_expiry <= Time.current ||
        (operation.retry_expires_at && operation.retry_expires_at <= Time.current)
      return false unless expired

      operation.update!(status: "expired", retry_at: nil, failure_code: "media_expired")
      if operation.ai_task
        AiTasks::UpdateTaskService.call(task: operation.ai_task, attributes: { status: "failed", error_message: "media_expired", completed_at: Time.current })
      end
      true
    end

    # A final failure (or the last allowed attempt) makes the recording unusable.
    def after_failure(_code, retryable:, automatic:)
      return unless (operation.turn? || operation.transcription?) && (!retryable || operation.execution_count >= AiExecutions::OperationLifecycle::MAX_EXECUTIONS)

      InterviewSessionMedia.where(id: operation.recording_id, interview_session_id: operation.interview_session_id, kind: "recording")
        .update_all(expires_at: Time.current)
    end
  end
end

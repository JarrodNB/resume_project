# Records a current execution failure and schedules bounded recovery. Safe failure codes
# are persisted instead of raw provider errors, which may contain private content.
module Interviews
  class FailOperationService < ApplicationService
    include ExecutionPolicy

    def initialize(operation:, attempt_id:, claim_generation:, code:, retryable:)
      @operation, @attempt_id, @generation, @code, @retryable = operation, attempt_id, claim_generation, code, retryable
    end

    def call
      return failure("Invalid failure") unless FAILURE_CODES.include?(@code) && [ true, false ].include?(@retryable)

      with_operation_lock do
        next failure("Claim is stale or expired") unless current_claim?
        fail_execution(@code, retryable: @retryable && !%w[invalid_recording transcript_too_long empty_audio audio_too_large audio_too_long context_limit screening_blocked].include?(@code))
        success({ status: @operation.status, failure_code: @operation.failure_code, retry_at: @operation.retry_at })
      end
    end
  end
end

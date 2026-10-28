# Record a current execution failure without adding rejected text to accepted history.
module Chat
  class FailOperationService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:, attempt_id:, claim_generation:, code:, retryable:)
      @operation, @attempt_id, @generation, @code, @retryable = operation, attempt_id, claim_generation, code, retryable
    end

    def call
      return failure("Invalid failure report") unless FAILURE_CODES.include?(@code) && [true, false].include?(@retryable)
      with_operation_lock do
        next success({ status: @operation.status }) if @operation.accepted?
        next failure("Claim is stale or expired") unless current_claim?
        fail_execution(@code, retryable: @retryable && !%w[screening_blocked screening_unavailable context_limit].include?(@code))
        success({ status: @operation.status })
      end
    end
  end
end

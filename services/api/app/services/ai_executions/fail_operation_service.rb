# Record a failure reported by the AI runtime for the exact current attempt (chat and interviews).
# Only known failure codes are stored, never raw provider errors, which may hold private text.
module AiExecutions
  class FailOperationService < ApplicationService
    def initialize(operation:, attempt_id:, claim_generation:, code:, retryable:)
      @operation, @attempt_id, @generation, @code, @retryable = operation, attempt_id, claim_generation, code, retryable
    end

    def call
      lifecycle = OperationLifecycle.for(@operation)
      policy = lifecycle.policy
      return failure(policy.invalid_failure_message) unless policy.failure_codes.include?(@code) && [ true, false ].include?(@retryable)

      lifecycle.with_lock do
        next success(policy.settled_failure_report) if policy.settled_failure_report
        next failure("Claim is stale or expired") unless lifecycle.current_claim?(@attempt_id, @generation)

        lifecycle.fail_execution(@code, retryable: @retryable && !policy.non_retryable_codes.include?(@code))
        success(policy.failure_report)
      end
    end
  end
end

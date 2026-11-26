# Mixin that gives interview services the shared lifecycle helpers (lock, fence check, failure).
# The rules themselves live in `AiExecutions::OperationLifecycle` and `Interviews::OperationPolicy`.
# No provider or storage I/O is allowed while these database locks are held.
# Terminal task changes record owner-visible outcomes in the same transaction.
module Interviews
  module ExecutionPolicy
    private

    # Rebuilt when @operation changes, because some services (backfill) walk several operations.
    def lifecycle
      return @lifecycle if @lifecycle&.operation.equal?(@operation)

      @lifecycle = AiExecutions::OperationLifecycle.new(@operation, OperationPolicy.new(@operation))
    end

    def with_operation_lock(&block)
      lifecycle.with_lock(&block)
    end

    def current_claim?
      lifecycle.current_claim?(@attempt_id, @generation)
    end

    def expire_operation(_interview)
      lifecycle.policy.expire_if_due?
    end

    def reject_allowance(expiry:, allowance: nil)
      # No new dispatch began. Preserve valid media for an explicit retry, while
      # releasing the task slot and preventing automatic execution retries.
      # A refused ended plan gets its own code so the web app can offer a subscribe prompt.
      code = allowance ? AiUsage::CheckAiTaskAllowanceService.refusal_code(allowance) : "ai_usage_limit_reached"
      @operation.update!(status: "failed", failure_code: code, retry_at: nil,
        retry_expires_at: @operation.retry_expires_at || expiry)
      AiTasks::UpdateTaskService.call(task: @operation.ai_task, attributes: { status: "failed", completed_at: Time.current, error_message: code }) if @operation.ai_task
    end

    def fail_execution(code, retryable:)
      lifecycle.fail_execution(code, retryable: retryable)
    end
  end
end

# Mixin that gives chat services the shared lifecycle helpers (lock, fence check, failure).
# The rules themselves live in `AiExecutions::OperationLifecycle` and `Chat::OperationPolicy`.
# No provider or network I/O runs while owner/chat/operation locks are held.
module Chat
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

    def fail_execution(code, retryable:)
      lifecycle.fail_execution(code, retryable: retryable)
    end
  end
end

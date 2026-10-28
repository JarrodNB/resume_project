# Chat-owned lifecycle rules behind the shared execution runner and durable jobs.
# No provider or network I/O runs while owner/chat/operation locks are held.
module Chat
  module ExecutionPolicy
    LEASE = 30.seconds
    DEADLINE = 120.seconds
    BACKOFF = [2, 5, 10].freeze
    FAILURE_CODES = %w[ai_usage_limit_reached dependency_unavailable context_limit screening_blocked screening_unavailable execution_failed execution_timeout lease_expired].freeze

    private

    def with_operation_lock
      conversation = @operation.chat_conversation
      conversation.user.with_lock(requires_new: true) do
        conversation.lock!
        @operation.lock!
        @operation.ai_task.lock!
        yield conversation
      end
    end

    def current_claim?
      @operation.running? && @attempt_id.present? && @operation.attempt_id == @attempt_id &&
        @operation.claim_generation == @generation && @operation.lease_expires_at > Time.current &&
        @operation.execution_deadline > Time.current && @operation.retry_expires_at > Time.current
    end

    def fail_execution(code, retryable:)
      automatic = retryable && @operation.cycle_execution_count < 3 && @operation.execution_count < 6 &&
        @operation.retry_expires_at > Time.current
      @operation.update!(status: automatic ? "pending" : "failed", failure_code: code,
        retry_at: automatic ? Time.current + BACKOFF.fetch([@operation.cycle_execution_count - 1, 0].max).seconds : nil)
      ScheduleOperationService.call(operation: @operation) if automatic
      AiTasks::UpdateTaskService.call(task: @operation.ai_task, attributes: { status: automatic ? "queued" : "failed",
        completed_at: automatic ? nil : Time.current, error_message: code })
      PublishUpdateService.call(conversation: @operation.chat_conversation)
    end
  end
end

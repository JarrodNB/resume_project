# Reserve a fenced attempt, unknown-cost marker and watchdog before returning input references.
module Chat
  class ClaimOperationService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:)
      @operation = operation
    end

    def call
      with_operation_lock do |conversation|
        if @operation.running?
          next failure("Operation already claimed") if @operation.lease_expires_at > Time.current && @operation.execution_deadline > Time.current
          fail_execution("lease_expired", retryable: true)
          next failure("Recovery scheduled")
        end
        next failure("Operation is not eligible") unless @operation.pending? && (!@operation.retry_at || @operation.retry_at <= Time.current)
        if @operation.retry_expires_at <= Time.current || @operation.execution_count >= 6 || @operation.cycle_execution_count >= 3
          fail_execution("execution_timeout", retryable: false)
          next failure("Execution limit reached")
        end
        next failure("Chat revision changed") unless (conversation.messages.maximum(:position) || 0) == @operation.expected_position
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: conversation.user, existing_task: @operation.ai_task)
        unless allowance.success?
          fail_execution("ai_usage_limit_reached", retryable: false)
          next allowance
        end
        plan = ContextPlanService.call(conversation: conversation, operation: @operation)
        unless plan.success?
          code = plan.errors.first
          fail_execution(code, retryable: false)
          next failure(code == "context_limit" ? "Chat context exceeds the safe input limit" : "Chat history is not approved")
        end
        context = plan.value
        @operation.update!(status: "running", attempt_id: SecureRandom.uuid, claim_generation: @operation.claim_generation + 1,
          execution_count: @operation.execution_count + 1, cycle_execution_count: @operation.cycle_execution_count + 1,
          lease_expires_at: LEASE.from_now, execution_deadline: DEADLINE.from_now, retry_at: nil, failure_code: nil,
          summary_base_version: conversation.summary_version, summary_plan: context[:summary_plan] || {})
        @operation.execution_attempts.create!(attempt_id: @operation.attempt_id, claim_generation: @operation.claim_generation)
        ScheduleRecoveryService.call(operation: @operation)
        AiTasks::RecordAttemptUsageService.call(ai_task: @operation.ai_task,
          message: { "attempt_id" => @operation.attempt_id, "attempt_finished" => false })
        @operation.ai_task.update!(status: "queued", completed_at: nil, error_message: nil)
        PublishUpdateService.call(conversation: conversation)
        success({ operation_id: @operation.id, attempt_id: @operation.attempt_id, claim_generation: @operation.claim_generation,
          lease_expires_at: @operation.lease_expires_at, execution_deadline: @operation.execution_deadline,
          payload: { version: 1, conversation_id: conversation.id, user_id: conversation.user_id,
            expected_position: context.fetch(:expected_position), summary_base_version: context.fetch(:summary_base_version),
            summary_through_position: context.fetch(:summary_through_position), summary_plan: context[:summary_plan],
            max_input_characters: ChatLimits::MAX_INPUT_CHARACTERS,
            summarize_every_user_messages: ChatLimits::SUMMARIZE_EVERY_USER_MESSAGES } })
      end
    end
  end
end

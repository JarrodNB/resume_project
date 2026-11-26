# Reserve a fenced attempt, unknown-cost marker and watchdog before returning input references.
# The attempt, lease and budget rules are shared (`AiExecutions::OperationLifecycle`); this
# service adds the chat checks: current revision, allowance and the rolling-memory plan.
module Chat
  class ClaimOperationService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:)
      @operation = operation
    end

    def call
      with_operation_lock do |conversation|
        running_error = lifecycle.running_claim_error
        next failure(running_error) if running_error
        next failure("Operation is not eligible") unless lifecycle.pending_and_due?
        if !lifecycle.retry_window_open? || lifecycle.executions_exhausted?
          fail_execution("execution_timeout", retryable: false)
          next failure("Execution limit reached")
        end
        next failure("Chat revision changed") unless (conversation.messages.maximum(:position) || 0) == @operation.expected_position
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: conversation.user, existing_task: @operation.ai_task)
        unless allowance.success?
          fail_execution(AiUsage::CheckAiTaskAllowanceService.refusal_code(allowance), retryable: false)
          next allowance
        end
        plan = ContextPlanService.call(conversation: conversation, operation: @operation)
        unless plan.success?
          code = plan.errors.first
          fail_execution(code, retryable: false)
          next failure(code == "context_limit" ? "Chat context exceeds the safe input limit" : "Chat history is not approved")
        end
        context = plan.value
        lifecycle.reserve_attempt!(summary_base_version: conversation.summary_version, summary_plan: context[:summary_plan] || {})
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

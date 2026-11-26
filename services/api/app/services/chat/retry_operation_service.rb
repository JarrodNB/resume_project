# Explicit retry preserves the logical submission and bill but never resurrects obsolete chat revisions.
module Chat
  class RetryOperationService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:)
      @operation = operation
    end

    def call
      with_operation_lock do |conversation|
        next success(@operation) if @operation.pending? || @operation.running? || @operation.accepted?
        next failure("Retry is no longer available; send a new message") unless lifecycle.retry_window_open? && lifecycle.total_budget_left? &&
          (conversation.messages.maximum(:position) || 0) == @operation.expected_position
        next failure("Wait for the current reply to finish") if conversation.operations.where(status: %w[pending running]).where.not(id: @operation.id).exists?
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: conversation.user, existing_task: @operation.ai_task)
        next allowance unless allowance.success?
        lifecycle.reopen_for_retry!(retry_at: nil)
        PublishUpdateService.call(conversation: conversation)
        success(@operation)
      end
    end
  end
end

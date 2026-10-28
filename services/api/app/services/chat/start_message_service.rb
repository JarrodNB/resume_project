# Admit a logical chat submission once under the general AI allowance and commit delivery with it.
module Chat
  class StartMessageService < ApplicationService
    def initialize(conversation:, message:, idempotency_key:)
      @conversation, @message, @key = conversation, message, idempotency_key
    end

    def call
      return failure("Enter a message") unless @message.is_a?(String) && @message.strip.present?
      return failure("Message exceeds #{ChatLimits::MAX_INPUT_CHARACTERS} characters") if @message.length > ChatLimits::MAX_INPUT_CHARACTERS
      return failure("Invalid submission identity") unless @key.is_a?(String) && @key.length.between?(1, 100)

      user = @conversation.user
      user.with_lock do
        @conversation.lock!
        existing = @conversation.operations.find_by(idempotency_key: @key)
        next(existing.message == @message ? success(existing) : failure("Submission identity conflicts")) if existing
        next failure("Wait for the current reply to finish") if @conversation.operations.where(status: %w[pending running]).exists?
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: user)
        next allowance unless allowance.success?
        task = user.ai_tasks.create!(task_type: "chat_reply", subject: @conversation, input: {})
        operation = @conversation.operations.create!(ai_task: task, message: @message, idempotency_key: @key,
          expected_position: @conversation.messages.maximum(:position) || 0, retry_expires_at: 1.hour.from_now)
        task.update!(input: { operation_id: operation.id })
        ScheduleOperationService.call(operation: operation)
        PublishUpdateService.call(conversation: @conversation)
        success(operation)
      end
    end
  end
end

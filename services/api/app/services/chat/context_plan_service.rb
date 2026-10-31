# Checks uncovered accepted dialogue and plans summary checkpoints without copying sources.
# Called under the chat lock. The model never chooses which saved messages it may replace.
require "digest"
module Chat
  class ContextPlanService < ApplicationService
    MAX_SOURCE_CHARACTERS = 200_000
    MAX_SOURCE_MESSAGES = 1000
    # Leave room for labels, instructions and masking before Python's exact 120k check.
    CONTEXT_BUDGET = 110_000
    SUMMARY_RESERVE = 8000

    def initialize(conversation:, operation:)
      @conversation, @operation = conversation, operation
    end

    def call
      through = @conversation.summary_through_position
      last = @operation.expected_position
      return failure("screening_unavailable") unless through <= last && last.even?
      scope = @conversation.messages.where("position > ?", through).reorder(:position)
      count = scope.count
      return failure("screening_unavailable") unless count == last - through && count.even?
      return failure("context_limit") if count > MAX_SOURCE_MESSAGES ||
        scope.sum("char_length(content)") + @operation.message.length + @conversation.summary_text.length > MAX_SOURCE_CHARACTERS

      history = scope.to_a
      unless history.each_with_index.all? { |message, index| message.position == through + index + 1 &&
        message.role == (index.even? ? "user" : "assistant") &&
        (message.assistant? || message.screened_sha256 == Digest::SHA256.hexdigest(message.content)) }
        return failure("screening_unavailable")
      end
      scheduled = ((last / 2 + 1) % ChatLimits::SUMMARIZE_EVERY_USER_MESSAGES).zero?
      target = scheduled ? (last / 2 + 1 - 5) * 2 : through
      if count >= 900 || estimated_size(history, @conversation.summary_text.length) > CONTEXT_BUDGET
        scheduled = false
        target = last - 10 # Five existing complete exchanges, plus the pending input.
        return failure("context_limit") if target <= through
        remaining = history.select { |message| message.position > target }
        return failure("context_limit") if estimated_size(remaining, SUMMARY_RESERVE) > CONTEXT_BUDGET
      end
      plan = target > through ? { through_position: target, scheduled: scheduled } : nil
      success(expected_position: last, summary_base_version: @conversation.summary_version,
        summary_through_position: through, summary_plan: plan)
    end

    private

    def estimated_size(messages, summary_size)
      messages.sum { |message| message.content.length + 100 } + @operation.message.length + summary_size + 1500
    end
  end
end

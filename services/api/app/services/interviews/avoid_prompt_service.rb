# Save the exact current spoken question or follow-up without changing the interview.
module Interviews
  class AvoidPromptService < ApplicationService
    def initialize(interview:, message_id:)
      @interview, @message_id = interview, message_id
    end

    # Receives an owned session; the saved message identity fences a stale visible prompt.
    def call
      @interview.user.with_lock do
        @interview.lock!
        message = @interview.messages.find_by(id: @message_id, kind: %w[opening follow_up])
        next failure("Question is no longer current") unless ClarificationPrompt.current?(@interview, message)

        InterviewPreferences::SaveAvoidedQuestionService.call(user: @interview.user, question_text: message.content)
      end
    end
  end
end

# Saves the live interviewer's spoken "Quick feedback" for the current question as text, so the
# completed review can show it under the question's latest answer. Later feedback for the same
# question replaces it (only the latest is kept); a repeat of the saved words changes nothing.
module Interviews
  class RecordLiveFeedbackService < ApplicationService
    def initialize(connection:, question_position:, text:)
      @connection, @question_position, @text = connection, question_position, text
    end

    # @return [ServiceResult<Hash>] `{ question_position:, revision: }`
    def call
      limit = InterviewSessionQuestion::LIVE_FEEDBACK_LIMIT
      return failure("Enter the feedback within #{limit} characters") unless @text.is_a?(String) && @text.strip.length.between?(1, limit)

      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("The live agent has not claimed this connection") unless @connection.status == "connected"
        question = interview.questions.lock.find_by(position: @question_position)
        next failure("Question is no longer current") unless question && question.position == interview.current_question_position
        content = @text.strip
        unless question.live_feedback == content
          question.update!(live_feedback: content)
          interview.update!(revision: interview.revision + 1)
        end
        success({ question_position: question.position, revision: interview.revision })
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end

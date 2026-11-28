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
      return LiveConnectionAccess.invalid_request("Invalid feedback report") unless LiveConnectionAccess.count?(@question_position) && @text.is_a?(String)
      limit = InterviewSessionQuestion::LIVE_FEEDBACK_LIMIT
      return failure("Enter the feedback within #{limit} characters") unless @text.strip.length.between?(1, limit)

      LiveConnectionAccess.with_locked(@connection, claimed: true) do |interview|
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

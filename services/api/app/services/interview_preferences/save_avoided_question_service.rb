# Save exact server-owned question text once; reject capacity limits without dropping choices.
module InterviewPreferences
  class SaveAvoidedQuestionService < ApplicationService
    def initialize(user:, question_text:)
      @user, @text = user, question_text
    end

    # Caller must derive text from an authorized persisted question or interviewer message.
    # @return [ServiceResult<Boolean>] durable success or an actionable validation error
    def call
      return failure([ "This question is blank or exceeds the 2,000-character saved question limit." ]) if @text.blank? || @text.length > AvoidedQuestions::MAX_QUESTION_CHARACTERS

      @user.with_lock do
        next success(true) if AvoidedQuestions.saved?(@user, @text)
        if @user.avoided_interview_questions.count >= AvoidedQuestions::MAX_QUESTIONS
          next failure([ "You have reached the limit of 50 avoided interview questions." ])
        end
        @user.avoided_interview_questions.create!(question_text: @text, text_digest: AvoidedQuestions.digest(@text))
        success(true)
      end
    end
  end
end

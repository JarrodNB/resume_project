# Capture the exact written question revision the user selected without changing its answer.
module InterviewPrep
  class AvoidQuestionService < ApplicationService
    def initialize(user:, question:, expected_revision:)
      @user, @question, @expected_revision = user, question, expected_revision
    end

    # Receives an already-authorized question and fences a stale page against replacements.
    def call
      @user.with_lock do
        @question.reload
        next failure([ "This question changed. Reload it before saving this preference." ]) unless @question.question_revision == @expected_revision

        InterviewPreferences::SaveAvoidedQuestionService.call(user: @user, question_text: @question.question_text)
      end
    end
  end
end

# Deletes one authorized practice question and its answer, feedback, and derived vector.
# The owner lock serializes deletion against saves and AI results; usage records remain.
module InterviewPrep
  class DeleteQuestionService < ApplicationService
    def initialize(question:)
      @question = question
    end

    def call
      @question.interview_question_set.user.with_lock do
        @question.reload
        @question.destroy ? success(@question) : failure(@question.errors)
      end
    end
  end
end

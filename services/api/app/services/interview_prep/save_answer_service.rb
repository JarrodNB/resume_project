# Description: Explicitly saves a typed practice answer, incrementing its revision only on changes.
# Index:
#   - call: validates and saves without changing feedback or career-library content
module InterviewPrep
  class SaveAnswerService < ApplicationService
    # Receives an authorized question and the exact user-written answer.
    def initialize(question:, answer_text:)
      @question = question
      @answer_text = answer_text
    end

    # Serializes saving with question task creation through the same owner lock.
    def call
      @question.interview_question_set.user.with_lock do
        @question.reload
        if @question.ai_tasks.where(task_type: "regenerate_interview_question", status: "queued").exists?
          next failure([ "Wait for question regeneration to finish before editing the answer." ])
        end
        @question.answer_revision += 1 if @question.answer_text != @answer_text
        @question.answer_text = @answer_text
        @question.save ? success(@question) : failure(@question.errors)
      end
    end
  end
end

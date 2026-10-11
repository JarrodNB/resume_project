# Description: User-owned interview practice data and reloadable AI task status.
# Index:
#   - InterviewQuestionType: persisted practice fields and latest task
module Types
  class InterviewQuestionType < Types::BaseObject
    field :id, ID, null: false
    field :position, Integer, null: false
    field :question_text, String, null: false
    field :answer_text, String, null: false
    field :question_revision, Integer, null: false
    field :answer_revision, Integer, null: false
    field :feedback, GraphQL::Types::JSON, null: false
    field :feedback_question_revision, Integer
    field :feedback_answer_revision, Integer
    field :feedback_outdated, Boolean, null: false
    field :latest_task, Types::AiTaskType

    # Returns the latest question operation, including failures.
    def latest_task
      object.ai_tasks.order(created_at: :desc, id: :desc).first
    end

    # Checks reviewed revisions and allows capitalization or whitespace changes.
    def feedback_outdated
      ::InterviewPrep::FeedbackOutdatedService.call(question: object).value
    end
  end
end

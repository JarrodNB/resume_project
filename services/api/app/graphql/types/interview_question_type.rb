# Description: User-owned interview practice data and reloadable AI task status.
# Index:
#   - InterviewQuestionType: persisted practice fields and latest task
#   - retired_at/question_set: question-bank context; retired copies have no position
module Types
  class InterviewQuestionType < Types::BaseObject
    field :avoided, Boolean, null: false
    field :id, ID, null: false
    field :position, Integer, description: "Slot 1–5 for active questions; null for retired copies."
    field :retired_at, GraphQL::Types::ISO8601DateTime,
          description: "When an answered question was replaced and kept as a read-only copy."
    field :question_set, Types::InterviewQuestionSetType, null: false, method: :interview_question_set
    field :question_text, String, null: false
    field :answer_text, String, null: false
    field :question_revision, Integer, null: false
    field :answer_revision, Integer, null: false
    field :feedback, GraphQL::Types::JSON, null: false
    field :feedback_question_revision, Integer
    field :feedback_answer_revision, Integer
    field :feedback_outdated, Boolean, null: false
    field :latest_task, Types::AiTaskType

    def avoided
      ::InterviewPreferences::AvoidedQuestions.saved?(context[:current_user], object.question_text)
    end

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

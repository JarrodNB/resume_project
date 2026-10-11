# Description: User-owned interview practice data and reloadable AI task status.
# Index:
#   - InterviewQuestionSetType: persisted practice fields and latest task
module Types
  class InterviewQuestionSetType < Types::BaseObject
    field :id, ID, null: false
    field :number, Integer, null: false
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
    field :questions, [ Types::InterviewQuestionType ], null: false
    field :latest_task, Types::AiTaskType

    # Returns the latest generation task so progress survives reloads.
    def latest_task
      object.ai_tasks.order(created_at: :desc, id: :desc).first
    end
  end
end

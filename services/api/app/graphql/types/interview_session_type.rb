# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewSessionType < Types::BaseObject
    field :id, ID, null: false
    field :status, String, null: false
    field :execution_mode, String, null: false
    field :interview_type, String, null: false
    field :revision, Integer, null: false
    field :answer_cap, Integer, null: false
    field :current_question_position, Integer, null: false
    field :expires_at, GraphQL::Types::ISO8601DateTime, null: false
    field :questions, [ Types::InterviewSessionQuestionType ], null: false
    field :messages, [ Types::InterviewSessionMessageType ], null: false
    field :operations, [ Types::InterviewSessionOperationType ], null: false

    def operations
      object.operations.order(:created_at, :id)
    end
  end
end

# frozen_string_literal: true

# Description: An AI task's status and outcome. Message history stays server-side.
# Index:
#   - job: the Job a scrape_job task created
module Types
  class AiTaskType < Types::BaseObject
    field :id, ID, null: false
    field :task_type, Types::AiTaskTypeEnum, null: false
    field :status, Types::AiTaskStatusEnum, null: false
    field :result, GraphQL::Types::JSON
    field :pending_questions, GraphQL::Types::JSON, null: false,
          description: "Questions the AI is waiting on when status is NEEDS_USER_INPUT."
    field :error_message, String
    field :completed_at, GraphQL::Types::ISO8601DateTime
    field :accepted_at, GraphQL::Types::ISO8601DateTime,
          description: "When the user accepted the result into their data (e.g. imported a parsed resume)."
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
    field :job, Types::JobType, description: "The job a completed scrape_job task saved."

    # Returns the task's subject when it is a Job (subjects always belong to the task's user).
    def job
      object.subject if object.subject_type == "Job"
    end
  end
end

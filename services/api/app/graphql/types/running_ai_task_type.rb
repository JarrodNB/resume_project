# frozen_string_literal: true

# Description: One piece of the user's AI work still in progress, as shown on Home's AI work strip.
module Types
  class RunningAiTaskType < Types::BaseObject
    description "AI work still in progress, with a safe label and the page that shows it."

    field :id, ID, null: false
    field :task_type, Types::AiTaskTypeEnum, null: false, description: "The kind of AI work."
    field :label, String, null: false, description: "Short safe words naming the work, with the job title for job work."
    field :destination, String, null: false, description: "The app path that shows this work's progress or result."
    field :started_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end

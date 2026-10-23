# frozen_string_literal: true

# A single Markdown resume tailored to an optional surviving job.
module Types
  class ResumeType < Types::BaseObject
    field :id, ID, null: false
    field :title, String, null: false
    field :job, Types::JobType, description: "The job this resume is tailored to (null if the job was deleted)."
    field :markdown, String, null: false
    field :target_pages, Integer, null: false
    field :updated_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end

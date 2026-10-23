# frozen_string_literal: true

# Description: A resume tailored to a job, and its sections.
module Types
  class ResumeType < Types::BaseObject
    field :id, ID, null: false
    field :title, String, null: false
    field :target_page_count, Integer, null: false, description: "Preferred maximum length in pages (1 or 2), not a guaranteed fit."
    field :job, Types::JobType, description: "The job this resume is tailored to (null if the job was deleted)."
    field :sections, [ Types::ResumeSectionType ], null: false
    field :updated_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end

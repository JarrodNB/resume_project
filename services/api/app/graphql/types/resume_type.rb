# frozen_string_literal: true

# Description: A base or tailored resume and its sections.
module Types
  class ResumeType < Types::BaseObject
    field :id, ID, null: false
    field :title, String, null: false
    field :kind, Types::ResumeKindEnum, null: false
    field :job, Types::JobType, description: "The job this resume is tailored to (null for base resumes)."
    field :sections, [ Types::ResumeSectionType ], null: false
    field :updated_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end

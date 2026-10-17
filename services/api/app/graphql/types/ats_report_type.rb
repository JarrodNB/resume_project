# Current saved-input identity and independently fresh assessment categories.
module Types
  class AtsReportType < BaseObject
    field :id, ID, null: false
    field :run_id, ID, null: false
    field :content_fingerprint, String, null: false
    field :job_fingerprint, String, null: false
    field :rubric_version, String, null: false
    field :outdated, Boolean, null: false
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
    field :ai_task, AiTaskType
    field :job_alignment, AtsCategoryType, null: false
    field :content_quality, AtsCategoryType, null: false
    field :pdf_readability, AtsCategoryType, null: false
    field :overall_score, Integer
  end
end

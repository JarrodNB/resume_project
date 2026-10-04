# frozen_string_literal: true

# Description: Structured job profile and its application stage.
# Index:
#   - latest_gap_analysis: the newest analyze_gaps task comparing this job with the career library
module Types
  class JobType < Types::BaseObject
    field :id, ID, null: false
    field :title, String, null: false
    field :company, String, null: false
    field :location, String
    field :url, String
    field :description, String
    field :requirements, [ String ], null: false
    field :nice_to_haves, [ String ], null: false
    field :stage, Types::JobStageEnum, null: false
    field :applied_at, GraphQL::Types::ISO8601DateTime
    field :notes, String
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
    field :latest_gap_analysis, Types::AiTaskType,
          description: "The newest gap analysis of this job (its result holds gap_analysis), if any."

    # Returns the job's newest analyze_gaps task.
    def latest_gap_analysis
      object.latest_gap_analysis
    end
  end
end

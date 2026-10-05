# frozen_string_literal: true

# Description: Structured job profile and its application stage.
# Index:
#   - gap_responses: the user's answers to this job's requirements
#   - latest_gap_analysis: the newest analyze_gaps task comparing this job with the career library
#   - latest_tailoring: the newest tailor_resume task for this job
#   - resume: the newest resume saved for this job
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
    field :gap_responses, [ Types::JobGapResponseType ], null: false,
          description: "The user's answers to this job's requirements, keyed by requirement text."
    field :latest_gap_analysis, Types::AiTaskType,
          description: "The newest gap analysis of this job (its result holds gap_analysis), if any."
    field :latest_tailoring, Types::AiTaskType,
          description: "The newest tailoring task for this job, if any."
    field :resume, Types::ResumeType,
          description: "The newest resume saved for this job, if any."

    # Returns this job's answers, with their library facts.
    def gap_responses
      object.gap_responses.includes(:library_fact)
    end

    # Returns the job's newest analyze_gaps task.
    def latest_gap_analysis
      object.latest_gap_analysis
    end

    # Returns the job's newest tailor_resume task.
    def latest_tailoring
      object.latest_tailoring
    end

    # Returns the newest resume saved for this job.
    def resume
      object.resumes.order(created_at: :desc).first
    end
  end
end

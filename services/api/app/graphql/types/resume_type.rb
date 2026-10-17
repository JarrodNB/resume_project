# frozen_string_literal: true

# Description: A resume tailored to a job, and its sections.
module Types
  class ResumeType < Types::BaseObject
    field :ats_report, Types::AtsReportType

    def ats_report
      AtsChecks::ReadReportService.call(resume: object).value
    end

    field :id, ID, null: false
    field :title, String, null: false
    field :job, Types::JobType, description: "The job this resume is tailored to (null if the job was deleted)."
    field :sections, [ Types::ResumeSectionType ], null: false
    field :updated_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end

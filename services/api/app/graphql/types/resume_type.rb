# frozen_string_literal: true

# A saved resume and its section identity. Exporters use the fingerprint paired
# with these sections so another tab's changes cannot relabel an older PDF.
module Types
  class ResumeType < Types::BaseObject
    field :ats_report, Types::AtsReportType
    field :ats_content_fingerprint, String, null: false

    def ats_content_fingerprint
      AtsChecks::Snapshot.fingerprint(AtsChecks::Snapshot.content(object))
    end

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

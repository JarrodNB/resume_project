# Explicit retries always assess owned saved content, never client-supplied resume text.
module Mutations
  module AtsChecks
    class RerunResumeAtsCheck < BaseMutation
      argument :resume_id, ID, required: true
      field :report, Types::AtsReportType
      def resolve(resume_id:)
        resume = current_user.resumes.find(resume_id)
        result = ::AtsChecks::ScheduleContentCheckService.call(resume: resume, force: true)
        return { report: nil, errors: result.errors } unless result.success?
        { report: ::AtsChecks::ReadReportService.call(resume: resume, run: result.value).value, errors: [] }
      end
    end
  end
end

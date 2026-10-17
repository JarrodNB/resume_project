# Accept the actual exported bytes only for a currently owned saved version.
module Mutations
  module AtsChecks
    class SubmitResumeAtsPdf < BaseMutation
      argument :resume_id, ID, required: true
      argument :run_id, ID, required: true
      argument :content_fingerprint, String, required: true
      argument :renderer_version, String, required: true
      argument :file, ApolloUploadServer::Upload, required: true
      field :report, Types::AtsReportType
      def resolve(resume_id:, **arguments)
        result = ::AtsChecks::StartPdfCheckService.call(resume: current_user.resumes.find(resume_id), **arguments)
        payload_from(result, :report)
      end
    end
  end
end

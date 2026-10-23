# Accepts an exact browser export for private, asynchronous LibreOffice pagination.
# Drafts need no saved resume; a supplied resume must belong to the current user.
module Mutations
  module ResumeTailoring
    class StartResumeDocxPageCheck < Mutations::BaseMutation
      argument :file, ApolloUploadServer::Upload, required: true
      argument :content_digest, String, required: true
      argument :resume_id, ID, required: false
      argument :retry_failed, Boolean, required: false, default_value: false
      field :check, Types::ResumeDocxPageCheckType

      def resolve(file:, content_digest:, resume_id: nil, retry_failed: false)
        resume = current_user.resumes.find(resume_id) if resume_id
        result = ::DocumentPageChecks::StartCheckService.call(user: current_user, file: file,
          content_digest: content_digest, resume: resume, retry_failed: retry_failed)
        payload_from(result, :check)
      end
    end
  end
end

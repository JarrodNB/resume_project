# frozen_string_literal: true

# Description: Uploads a resume file (multipart GraphQL request) and starts AI parsing. Follow
# progress with the aiTaskUpdated subscription; the result is a ParsedResume to review.
module Mutations
  module ResumeImports
    class ParseResume < Mutations::BaseMutation
      argument :file, ApolloUploadServer::Upload, required: true, description: "A PDF or DOCX resume, 5 MB max."

      field :ai_task, Types::AiTaskType

      # Calls ResumeImports::StartResumeParsingService.
      def resolve(file:)
        result = ::ResumeImports::StartResumeParsingService.call(user: current_user, file: file)
        payload_from(result, :ai_task)
      end
    end
  end
end

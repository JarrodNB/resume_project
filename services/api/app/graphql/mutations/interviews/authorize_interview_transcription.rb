# Authorize an owned capture through the same session and CSRF checks as other interview writes.
module Mutations
  module Interviews
    class AuthorizeInterviewTranscription < BaseInterviewMutation
      argument :interview_id, ID, required: true
      argument :question_id, ID, required: true
      argument :expected_revision, Integer, required: true
      field :capture_id, ID, null: true
      field :token, String, null: true

      def resolve(interview_id:, **args)
        result = ::Interviews::AuthorizeTranscriptionService.call(interview: interview(interview_id), **args)
        (result.success? ? result.value : {}).merge(errors: result.errors)
      end
    end
  end
end

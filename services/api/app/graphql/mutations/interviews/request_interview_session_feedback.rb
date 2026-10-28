# Starts completed-interview coaching only after an explicit owner request.
module Mutations
  module Interviews
    class RequestInterviewSessionFeedback < BaseInterviewMutation
      argument :interview_id, ID, required: true
      argument :retry_failed, Boolean, required: false, default_value: false
      field :feedback, Types::InterviewSessionFeedbackType, null: true

      def resolve(interview_id:, retry_failed: false)
        result = ::Interviews::SessionFeedback.new.request(interview: interview(interview_id), retry_failed: retry_failed)
        { feedback: result.value, errors: result.errors }
      end
    end
  end
end

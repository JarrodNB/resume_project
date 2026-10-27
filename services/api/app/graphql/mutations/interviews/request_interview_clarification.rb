# Requests an explanation for an owned current prompt without submitting an answer.
module Mutations
  module Interviews
    class RequestInterviewClarification < BaseDemoMutation
      argument :interview_id, ID, required: true
      argument :message_id, ID, required: true
      argument :retry_failed, Boolean, required: false, default_value: false
      field :clarification, Types::InterviewClarificationType, null: true

      def resolve(interview_id:, **args)
        result = ::Interviews::CurrentPromptWork::Clarification.new.request(interview: interview(interview_id), **args)
        { clarification: result.success? ? result.value : nil, errors: result.errors }
      end
    end
  end
end

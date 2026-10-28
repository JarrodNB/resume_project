# Requests saved evidence for an owned prompt without submitting or changing an answer.
module Mutations
  module Interviews
    class RequestInterviewReferences < BaseInterviewMutation
      argument :interview_id, ID, required: true
      argument :message_id, ID, required: true
      argument :retry_failed, Boolean, required: false, default_value: false
      field :career_references, Types::InterviewCareerReferencesType, null: true

      def resolve(interview_id:, **args)
        result = ::Interviews::CurrentPromptWork::References.new.request(interview: interview(interview_id), **args)
        { career_references: result.success? ? result.value : nil, errors: result.errors }
      end
    end
  end
end

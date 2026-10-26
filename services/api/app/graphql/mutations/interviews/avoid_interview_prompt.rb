# Authorize the spoken session before saving its visible prompt as a shared preference.
module Mutations
  module Interviews
    class AvoidInterviewPrompt < BaseDemoMutation
      argument :interview_id, ID, required: true
      argument :message_id, ID, required: true
      field :saved, Boolean, null: false

      def resolve(interview_id:, message_id:)
        result = ::Interviews::AvoidPromptService.call(interview: interview(interview_id), message_id: message_id)
        { saved: result.success?, errors: result.errors }
      end
    end
  end
end

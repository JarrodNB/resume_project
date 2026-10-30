# Start or resume an owner-resolved queued preference conversation.
module Mutations
  module JobPreferences
    class StartConversation < Mutations::BaseMutation
      argument :message, String, required: true
      argument :expected_version, Integer, required: true
      argument :previous_task_id, ID, required: false
      field :ai_task, Types::AiTaskType

      def resolve(message:, expected_version:, previous_task_id: nil)
        payload_from(::JobPreferences::StartConversationService.call(user: current_user,
          message: message, expected_version: expected_version, previous_task_id: previous_task_id), :ai_task)
      end
    end
  end
end

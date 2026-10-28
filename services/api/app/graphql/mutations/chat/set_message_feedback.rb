# Resolves feedback targets through the owner's saved conversation; provisional output has no target.
module Mutations
  module Chat
    class SetMessageFeedback < BaseMutation
      argument :conversation_id, ID, required: true
      argument :message_id, ID, required: true
      argument :thumbs_down, Boolean, required: false
      argument :thumbs_up, Boolean, required: false
      field :message, Types::ChatMessageType

      def resolve(conversation_id:, message_id:, thumbs_down: nil, thumbs_up: nil)
        raise GraphQL::ExecutionError, "Authentication required" unless current_user

        conversation = current_user.chat_conversations.find(conversation_id)
        message = conversation.messages.find(message_id)
        payload_from(::Chat::SetMessageFeedbackService.call(message: message, thumbs_down: thumbs_down, thumbs_up: thumbs_up), :message)
      end
    end
  end
end

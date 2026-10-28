# Browser submissions resolve an owned chat before entering its durable execution policy.
module Mutations
  module Chat
    class SendMessage < BaseMutation
      argument :conversation_id, ID, required: true
      argument :message, String, required: true
      argument :idempotency_key, String, required: true
      field :operation, Types::ChatOperationType
      def resolve(conversation_id:, message:, idempotency_key:)
        raise GraphQL::ExecutionError, "Authentication required" unless current_user
        conversation = current_user.chat_conversations.find(conversation_id)
        payload_from(::Chat::StartMessageService.call(conversation: conversation, message: message, idempotency_key: idempotency_key), :operation)
      end
    end
  end
end

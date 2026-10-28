# Retry only an owned logical submission; the lifecycle service fences its saved revision.
module Mutations
  module Chat
    class RetryMessage < BaseMutation
      argument :operation_id, ID, required: true
      field :operation, Types::ChatOperationType
      def resolve(operation_id:)
        raise GraphQL::ExecutionError, "Authentication required" unless current_user
        operation = ChatOperation.joins(:chat_conversation).where(chat_conversations: { user_id: current_user.id }).find(operation_id)
        payload_from(::Chat::RetryOperationService.call(operation: operation), :operation)
      end
    end
  end
end

# Creates a chat owned by the authenticated account; generation is a separate action.
module Mutations
  module Chat
    class CreateConversation < BaseMutation
      field :conversation, Types::ChatConversationType

      def resolve
        raise GraphQL::ExecutionError, "Authentication required" unless current_user

        payload_from(::Chat::CreateConversationService.call(user: current_user), :conversation)
      end
    end
  end
end

# Live saved chat state, scoped to the same authenticated owner as ordinary GraphQL reads.
module Subscriptions
  class ChatConversationUpdated < BaseSubscription
    argument :id, ID, required: true
    type Types::ChatConversationType, null: false
    def subscribe(id:)
      current_user.chat_conversations.find(id)
    end
    def update(id:)
      object
    end
  end
end

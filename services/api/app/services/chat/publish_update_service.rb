# Publish saved state only after commit. A stream observer never owns execution.
module Chat
  class PublishUpdateService < ApplicationService
    def initialize(conversation:)
      @conversation = conversation
    end

    def call
      id = @conversation.id
      ActiveRecord.after_all_transactions_commit do
        saved = ChatConversation.find_by(id: id)
        ApiSchema.subscriptions.trigger(:chat_conversation_updated, { id: id }, saved) if saved
      end
      success
    end
  end
end

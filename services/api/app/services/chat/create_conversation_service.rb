# Starts a private saved chat without making a provider request or consuming AI allowance.
module Chat
  class CreateConversationService < ApplicationService
    def initialize(user:)
      @user = user
    end

    def call
      conversation = @user.chat_conversations.create(title: "New chat")
      conversation.persisted? ? success(conversation) : failure(conversation.errors)
    end
  end
end

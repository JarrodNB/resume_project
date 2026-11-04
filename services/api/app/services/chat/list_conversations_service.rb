# Pages the owner's saved chats with immutable creation-time keys so new chats cannot shift older pages.
module Chat
  class ListConversationsService < ApplicationService
    PAGE_SIZE = 20

    def initialize(user:, cursor: nil)
      @user, @cursor = user, cursor
    end

    def call
      result = Pagination::ReadCreatedPageService.call(records: @user.chat_conversations,
        cursor: @cursor, binding: { "user_id" => @user.id }, purpose: "chat-conversations", limit: PAGE_SIZE)
      return invalid_cursor unless result.success?

      success(conversations: result.value[:records], next_cursor: result.value[:next_cursor], errors: [])
    end

    private

    def invalid_cursor
      failure([ "Invalid chat list cursor. Reload the page to try again." ])
    end
  end
end

# Pages the owner's saved chats with immutable creation-time keys so new chats cannot shift older pages.
module Chat
  class ListConversationsService < ApplicationService
    PAGE_SIZE = 20

    def initialize(user:, cursor: nil)
      @user, @cursor = user, cursor
    end

    def call
      scope = @user.chat_conversations
      if @cursor.present?
        position = verifier.verified(@cursor, purpose: "chat-conversations")
        return invalid_cursor unless position.is_a?(Hash) && position["user_id"] == @user.id

        scope = scope.where("(created_at, id) < (?, ?)", Time.iso8601(position.fetch("created_at")), position.fetch("id"))
      end
      rows = scope.order(created_at: :desc, id: :desc).limit(PAGE_SIZE + 1).to_a
      page = rows.first(PAGE_SIZE)
      next_cursor = if rows.size > PAGE_SIZE
        last = page.last
        verifier.generate({ "user_id" => @user.id, "created_at" => last.created_at.iso8601(6), "id" => last.id }, purpose: "chat-conversations")
      end
      success(conversations: page, next_cursor: next_cursor, errors: [])
    rescue ArgumentError, KeyError
      invalid_cursor
    end

    private

    def invalid_cursor
      failure([ "Invalid chat list cursor. Reload the page to try again." ])
    end

    def verifier
      Rails.application.message_verifier("chat-conversations")
    end
  end
end

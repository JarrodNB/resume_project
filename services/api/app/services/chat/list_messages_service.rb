# Reads complete bounded windows of an already-authorized conversation, newest window first.
# Messages inside each window stay chronological; signed cursors cannot cross conversations.
module Chat
  class ListMessagesService < ApplicationService
    PAGE_SIZE = 30

    def initialize(conversation:, cursor: nil)
      @conversation, @cursor = conversation, cursor
    end

    def call
      messages = @conversation.messages.reorder(position: :desc)
      if @cursor.present?
        position = verifier.verified(@cursor, purpose: "chat-messages")
        return invalid_cursor unless position.is_a?(Hash) && position["conversation_id"] == @conversation.id && position["position"].is_a?(Integer) && position["position"].positive?

        messages = messages.where("position < ?", position["position"])
      end
      rows = messages.limit(PAGE_SIZE + 1).to_a
      page = rows.first(PAGE_SIZE)
      next_cursor = if rows.size > PAGE_SIZE
        verifier.generate({ "conversation_id" => @conversation.id, "position" => page.last.position }, purpose: "chat-messages")
      end
      success(messages: page.reverse, next_cursor: next_cursor, errors: [])
    end

    private

    def invalid_cursor
      failure([ "Invalid chat history cursor. Reload the chat to try again." ])
    end

    def verifier
      Rails.application.message_verifier("chat-messages")
    end
  end
end

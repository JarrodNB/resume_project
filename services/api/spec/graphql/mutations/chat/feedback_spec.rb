# Records undoable owner feedback on accepted replies without changing the conversation or execution state.
require "rails_helper"

RSpec.describe "Chat reply feedback" do
  let(:user) { create(:user) }
  let(:conversation) { create(:chat_conversation, user: user) }
  let(:reply) { create(:chat_message, chat_conversation: conversation, role: "assistant", position: 2) }
  let(:mutation) do
    'mutation($conversationId: ID!, $messageId: ID!, $thumbsDown: Boolean!) { setChatMessageFeedback(input: { conversationId: $conversationId, messageId: $messageId, thumbsDown: $thumbsDown }) { message { id thumbsDown } errors } }'
  end

  def feedback(value, owner: user, conversation_id: conversation.id, message_id: reply.id)
    execute_graphql(mutation, user: owner, variables: { conversationId: conversation_id, messageId: message_id, thumbsDown: value })
  end

  it "sets, persists and clears the desired feedback state idempotently" do
    response = feedback(true)
    expect(response["errors"]).to be_nil
    expect(response.dig("data", "setChatMessageFeedback", "errors")).to eq([])
    expect(reply.reload.thumbs_down).to be(true)
    feedback(true)
    expect(reply.reload.thumbs_down).to be(true)
    expect(feedback(false).dig("data", "setChatMessageFeedback", "message", "thumbsDown")).to be(false)
    expect(reply.reload.thumbs_down).to be(false)
  end
  it "exposes persisted feedback when accepted history is reopened" do
    feedback(true)
    query = 'query($id: ID!) { chatConversation(id: $id) { messages { messages { id thumbsDown } } } }'
    result = execute_graphql(query, user: user, variables: { id: conversation.id })
    expect(result.dig("data", "chatConversation", "messages", "messages")).to eq([ { "id" => reply.id, "thumbsDown" => true } ])
  end

  it "rejects user messages and unknown or provisional output identifiers" do
    input = create(:chat_message, chat_conversation: conversation, role: "user", position: 1)
    expect(feedback(true, message_id: input.id).dig("data", "setChatMessageFeedback", "errors")).to include(/only on saved assistant replies/)
    expect(input.reload.thumbs_down).to be(false)
    expect(feedback(true, message_id: SecureRandom.uuid)["errors"].first["message"]).to eq("Record not found")
  end

  it "hides foreign messages and prevents moving a message across owned chats" do
    expect(feedback(true, owner: create(:user))["errors"].first["message"]).to eq("Record not found")
    other = create(:chat_conversation, user: user)
    expect(feedback(true, conversation_id: other.id)["errors"].first["message"]).to eq("Record not found")
    expect(reply.reload.thumbs_down).to be(false)
  end

  it "requires authentication and preserves message text, history and accounting" do
    expect(feedback(true, owner: nil)["errors"].first["message"]).to eq("Authentication required")
    before_message = reply.attributes.except("thumbs_down", "updated_at")
    before_conversation = conversation.attributes
    expect { feedback(true) }.not_to change { [ user.ai_tasks.count, AiUsageAttempt.count, ChatOperation.count, conversation.messages.count ] }
    expect(reply.reload.attributes.except("thumbs_down", "updated_at")).to eq(before_message)
    expect(conversation.reload.attributes).to eq(before_conversation)
  end

  it "enforces assistant-only feedback at the database boundary" do
    input = create(:chat_message, chat_conversation: conversation, role: "user", position: 1)
    expect do
      ChatMessage.transaction(requires_new: true) { input.update_columns(thumbs_down: true) }
    end.to raise_error(ActiveRecord::StatementInvalid)
    expect(input.reload.thumbs_down).to be(false)
  end
end

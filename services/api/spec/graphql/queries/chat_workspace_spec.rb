# Verifies saved chat creation and private workspace reads through the public GraphQL interface.
require "rails_helper"

RSpec.describe "Saved chat workspace" do
  let(:user) { create(:user) }
  let(:create_query) { 'mutation { createChatConversation(input: {}) { conversation { id title createdAt } errors } }' }

  it "creates a saved conversation for its owner without model work" do
    response = execute_graphql(create_query, user: user)
    expect(response["errors"]).to be_nil
    payload = response.dig("data", "createChatConversation")
    expect(payload["errors"]).to eq([])
    expect(payload["conversation"]["title"]).to eq("New chat")
    expect(user.chat_conversations.find(payload["conversation"]["id"])).to be_persisted
    expect(user.ai_tasks).to be_empty
  end
  it "reopens only an owned conversation with empty history and effective settings" do
    id = execute_graphql(create_query, user: user).dig("data", "createChatConversation", "conversation", "id")
    query = 'query($id: ID!) { chatSettings { maxInputCharacters summarizeEveryUserMessages } chatConversation(id: $id) { id title messages { messages { id role content position } nextCursor errors } } }'
    response = execute_graphql(query, user: user, variables: { id: id })
    expect(response["errors"]).to be_nil
    expect(response.dig("data", "chatSettings")).to eq("maxInputCharacters" => 10_000, "summarizeEveryUserMessages" => 20)
    expect(response.dig("data", "chatConversation", "messages")).to eq("messages" => [], "nextCursor" => nil, "errors" => [])
    other = execute_graphql(query, user: create(:user), variables: { id: id })
    expect(other["errors"].first["message"]).to eq("Record not found")
  end
  it "pages saved conversations without gaps when newer chats arrive" do
    saved = Array.new(22) { |i| user.chat_conversations.create!(title: "Chat #{i}", created_at: i.minutes.ago) }
    create(:user).chat_conversations.create!(title: "Private")
    query = 'query($cursor: String) { chatConversations(cursor: $cursor) { conversations { id title } nextCursor errors } }'
    first = execute_graphql(query, user: user)
    expect(first["errors"]).to be_nil
    first = first.dig("data", "chatConversations")
    expect(first["conversations"].map { |row| row["id"] }).to eq(saved.first(20).map(&:id))
    user.chat_conversations.create!
    second = execute_graphql(query, user: user, variables: { cursor: first["nextCursor"] }).dig("data", "chatConversations")
    expect(second["conversations"].map { |row| row["id"] }).to eq(saved.last(2).map(&:id))
    expect(second["nextCursor"]).to be_nil
    foreign = execute_graphql(query, user: create(:user), variables: { cursor: first["nextCursor"] })
    expect(foreign.dig("data", "chatConversations", "errors")).to include(/Invalid chat list cursor/)
  end
  it "pages accepted messages chronologically with conversation-bound cursors" do
    chat = user.chat_conversations.create!
    34.times { |i| chat.messages.create!(role: i.even? ? "user" : "assistant", content: "Message #{i + 1}", position: i + 1) }
    query = 'query($id: ID!, $cursor: String) { chatConversation(id: $id) { messages(cursor: $cursor) { messages { id role content position } nextCursor errors } } }'
    first = execute_graphql(query, user: user, variables: { id: chat.id }).dig("data", "chatConversation", "messages")
    expect(first["messages"].map { |row| row["position"] }).to eq((5..34).to_a)
    chat.messages.create!(role: "user", content: "New message", position: 35)
    second = execute_graphql(query, user: user, variables: { id: chat.id, cursor: first["nextCursor"] }).dig("data", "chatConversation", "messages")
    expect(second["messages"].map { |row| row["position"] }).to eq((1..4).to_a)
    expect(second["nextCursor"]).to be_nil
    other = user.chat_conversations.create!
    crossed = execute_graphql(query, user: user, variables: { id: other.id, cursor: first["nextCursor"] })
    expect(crossed.dig("data", "chatConversation", "messages", "errors")).to include(/Invalid chat history cursor/)
    malformed = execute_graphql(query, user: user, variables: { id: chat.id, cursor: "bad" })
    expect(malformed.dig("data", "chatConversation", "messages", "errors")).to include(/Invalid chat history cursor/)
  end

  it "orders equal chat creation timestamps by id and rejects malformed cursors" do
    time = Time.current
    saved = Array.new(21) { user.chat_conversations.create!(created_at: time) }.sort_by(&:id).reverse
    query = 'query($cursor: String) { chatConversations(cursor: $cursor) { conversations { id } nextCursor errors } }'
    first = execute_graphql(query, user: user).dig("data", "chatConversations")
    second = execute_graphql(query, user: user, variables: { cursor: first["nextCursor"] }).dig("data", "chatConversations")
    expect([ *first["conversations"], *second["conversations"] ].map { |row| row["id"] }).to eq(saved.map(&:id))
    expect(execute_graphql(query, user: user, variables: { cursor: "bad" }).dig("data", "chatConversations", "errors")).to include(/Invalid chat list cursor/)
  end

  it "requires authentication for chat creation, history and settings" do
    expect(execute_graphql(create_query, user: nil)["errors"].first["message"]).to eq("Authentication required")
    expect(execute_graphql('{ chatConversations { errors } }', user: nil)["errors"].first["message"]).to eq("Authentication required")
    expect(execute_graphql('{ chatSettings { maxInputCharacters } }', user: nil)["errors"].first["message"]).to eq("Authentication required")
  end
end

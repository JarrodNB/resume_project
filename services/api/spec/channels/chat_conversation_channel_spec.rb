# Chat subscribers receive the current owned state before following later saved updates.
require "rails_helper"
RSpec.describe GraphqlChannel, type: :channel do
  let(:user) { create(:user) }
  let(:chat) { user.chat_conversations.create! }
  def open_chat(owner)
    stub_connection current_user: owner, session_valid?: true, check_session: nil
    subscribe
    perform :execute, "query" => 'subscription($id: ID!) { chatConversationUpdated(id:$id) { id latestOperation { id status updatedAt } } }', "variables" => { "id" => chat.id }
    transmissions.last
  end
  it "returns current chat state without starting any model work" do
    payload = open_chat(user)
    expect(payload["more"]).to be(true)
    expect(payload.dig("result", "data", "chatConversationUpdated")).to eq("id" => chat.id, "latestOperation" => nil)
    expect(user.ai_tasks).to be_empty
  end
  it "refuses to subscribe to another user's chat" do
    payload = open_chat(create(:user))
    expect(payload.dig("result", "errors", 0, "message")).to eq("Record not found")
  end
end

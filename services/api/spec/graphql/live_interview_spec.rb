# Exercises the public live interview interface: choosing live at start and joining a LiveKit room.
require "rails_helper"

RSpec.describe "Live interview GraphQL" do
  let(:user) { create(:user, summary: "I maintain laboratory instruments.") }

  before { allow(Interviews::RuntimeReadiness).to receive(:ready?).and_return(true) }

  it "starts a live preparation and exposes the saved conversation mode" do
    query = 'mutation($input: StartInterviewInput!) { startInterview(input: $input) { interview { id conversationMode setup { questionCount } } errors } }'
    result = execute_graphql(query, user: user, variables: { input: { conversationMode: "live", setup: { questionCount: 5 } } })
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "startInterview", "interview")).to include("conversationMode" => "live", "setup" => { "questionCount" => 5 })
    default = execute_graphql(query, user: user, variables: { input: {} })
    expect(default.dig("data", "startInterview", "interview", "conversationMode")).to eq("turn_based")
    refused = execute_graphql(query, user: user, variables: { input: { conversationMode: "live", setup: { questionCount: 12 } } })
    expect(refused.dig("data", "startInterview", "interview")).to be_nil
    expect(refused.dig("data", "startInterview", "errors")).to eq([ "Live interviews use 5 or 8 questions" ])
  end
end

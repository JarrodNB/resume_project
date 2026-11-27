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

  describe "joinLiveInterview" do
    let(:join) { 'mutation($input: JoinLiveInterviewInput!) { joinLiveInterview(input: $input) { url token roomName expiresAt interview { id status messages { id } } errors } }' }

    around { |example| with_livekit_env { example.run } }

    it "returns LiveKit join details only to the owner of a live interview" do
      interview = ready_live_interview(user)
      variables = { input: { interviewId: interview.id } }
      expect(execute_graphql(join, user: create(:user), variables: variables).dig("errors", 0, "message")).to eq("Record not found")
      expect(execute_graphql(join, user: nil, variables: variables).dig("errors", 0, "message")).to eq("Authentication required")
      result = execute_graphql(join, user: user, variables: variables)
      expect(result["errors"]).to be_nil
      payload = result.dig("data", "joinLiveInterview")
      expect(payload).to include("url" => "wss://live.example.test", "errors" => [],
        "roomName" => interview.live_connections.sole.room_name, "interview" => { "id" => interview.id, "status" => "active", "messages" => [] })
      expect(decode_livekit_token(payload["token"]).dig("video", "room")).to eq(payload["roomName"])
      expect(Time.iso8601(payload["expiresAt"])).to be_within(1.minute).of(10.minutes.from_now)
    end

    it "refuses turn-based interviews with an error result" do
      interview = ready_live_interview(user, conversation_mode: "turn_based")
      result = execute_graphql(join, user: user, variables: { input: { interviewId: interview.id } })
      expect(result.dig("data", "joinLiveInterview")).to include("token" => nil, "interview" => nil, "errors" => [ "This interview is not a live interview" ])
    end
  end
end

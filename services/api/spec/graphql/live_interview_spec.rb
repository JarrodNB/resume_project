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

    it "refuses a new room with fewer than 5 live minutes left, naming the reason, and reuses an open one" do
      interview = ready_live_interview(user)
      variables = { input: { interviewId: interview.id } }
      allow(Interviews::LiveAllowance).to receive(:remaining_seconds).and_return(299)
      refused = execute_graphql(join, user: user, variables: variables)
      expect(refused.dig("data", "joinLiveInterview")).to include("token" => nil, "interview" => nil,
        "errors" => [ "You need at least 5 live minutes to start a live interview. You have 4 minutes left." ])
      expect(execute_graphql('mutation($input: JoinLiveInterviewInput!) { joinLiveInterview(input: $input) { errorCode } }', user: user,
        variables: variables).dig("data", "joinLiveInterview", "errorCode")).to eq("LIVE_ALLOWANCE_LOW")
      expect(interview.reload).to have_attributes(status: "ready")
      expect(interview.live_connections).to be_empty

      allow(Interviews::LiveAllowance).to receive(:remaining_seconds).and_return(300)
      expect(execute_graphql(join, user: user, variables: variables).dig("data", "joinLiveInterview", "errors")).to eq([])
      allow(Interviews::LiveAllowance).to receive(:remaining_seconds).and_return(60)
      rejoin = execute_graphql(join, user: user, variables: variables).dig("data", "joinLiveInterview")
      expect(rejoin).to include("errors" => [], "roomName" => interview.live_connections.sole.room_name)
    end

    it "refuses turn-based interviews with an error result" do
      interview = ready_live_interview(user, conversation_mode: "turn_based")
      result = execute_graphql(join, user: user, variables: { input: { interviewId: interview.id } })
      expect(result.dig("data", "joinLiveInterview")).to include("token" => nil, "interview" => nil, "errors" => [ "This interview is not a live interview" ])
    end
  end

  it "shows the viewer their live seconds left and refuses a live preparation below 5 minutes" do
    query = '{ me { liveInterviewSecondsLeft } }'
    expect(execute_graphql(query, user: user).dig("data", "me", "liveInterviewSecondsLeft")).to eq(600)
    allow(Interviews::LiveAllowance).to receive(:remaining_seconds).and_return(240)
    start = 'mutation($input: StartInterviewInput!) { startInterview(input: $input) { interview { id } errors errorCode } }'
    refused = execute_graphql(start, user: user, variables: { input: { conversationMode: "live", setup: { questionCount: 5 } } })
    expect(refused.dig("data", "startInterview")).to include("interview" => nil, "errorCode" => "LIVE_ALLOWANCE_LOW",
      "errors" => [ "You need at least 5 live minutes to start a live interview. You have 4 minutes left." ])
    turn_based = execute_graphql(start, user: user, variables: { input: { setup: { questionCount: 5 } } })
    expect(turn_based.dig("data", "startInterview", "errors")).to eq([])
    expect(user.interview_sessions.pluck(:conversation_mode)).to eq([ "turn_based" ])
  end

  it "shows the owner each question's saved live feedback, and nothing for questions without it" do
    interview = ready_live_interview(user)
    interview.questions.find_by!(position: 0).update!(live_feedback: "Quick feedback: clear example. Lead with the result.")
    query = 'query($id: ID!) { interviewSession(id: $id) { questions { position liveFeedback } } }'
    expect(execute_graphql(query, user: create(:user), variables: { id: interview.id }).dig("data", "interviewSession")).to be_nil
    questions = execute_graphql(query, user: user, variables: { id: interview.id }).dig("data", "interviewSession", "questions")
    expect(questions.find { |question| question["position"] == 0 }["liveFeedback"]).to eq("Quick feedback: clear example. Lead with the result.")
    expect(questions.find { |question| question["position"] == 1 }["liveFeedback"]).to be_nil
  end

  describe "endLiveInterview" do
    let(:end_live) { 'mutation($input: EndLiveInterviewInput!) { endLiveInterview(input: $input) { interview { id status } errors } }' }

    around { |example| with_livekit_env { example.run } }

    it "finishes the owner's live interview when the agent is gone: completed with an answer, the same on repeat" do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      question = interview.questions.first
      interview.messages.create!(question: question, kind: "opening", position: 0, semantic_key: "question:#{question.id}:opening", content: question.content)
      interview.messages.create!(question: question, kind: "answer", position: 1, semantic_key: "live_answer:x", content: "My answer.")
      variables = { input: { interviewId: interview.id } }
      expect(execute_graphql(end_live, user: create(:user), variables: variables).dig("errors", 0, "message")).to eq("Record not found")
      result = execute_graphql(end_live, user: user, variables: variables)
      expect(result.dig("data", "endLiveInterview")).to eq("interview" => { "id" => interview.id, "status" => "completed" }, "errors" => [])
      expect(interview.live_connections.sole).to have_attributes(status: "ended", end_reason: "ended_by_candidate")
      again = execute_graphql(end_live, user: user, variables: variables)
      expect(again.dig("data", "endLiveInterview", "interview", "status")).to eq("completed")
    end

    it "ends a room the candidate leaves for the turn-based fallback as failed, so it never stays active" do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      result = execute_graphql(end_live, user: user, variables: { input: { interviewId: interview.id, liveUnavailable: true } })
      expect(result.dig("data", "endLiveInterview", "interview", "status")).to eq("abandoned")
      expect(interview.live_connections.sole).to have_attributes(status: "ended", end_reason: "failed")
    end

    it "abandons a live interview with no answers and refuses one that never opened a room" do
      interview = ready_live_interview(user)
      variables = { input: { interviewId: interview.id } }
      expect(execute_graphql(end_live, user: user, variables: variables).dig("data", "endLiveInterview", "errors")).to eq([ "This interview has no live room" ])
      Interviews::JoinLiveService.call(interview: interview)
      result = execute_graphql(end_live, user: user, variables: variables)
      expect(result.dig("data", "endLiveInterview", "interview", "status")).to eq("abandoned")
    end
  end
end

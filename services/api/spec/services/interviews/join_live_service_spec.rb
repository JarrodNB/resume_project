# Checks who may open a live room and what the LiveKit join token allows.
require "rails_helper"

RSpec.describe Interviews::JoinLiveService do
  let(:user) { create(:user, summary: "I maintain laboratory instruments.") }
  let(:interview) { ready_live_interview(user) }

  around { |example| with_livekit_env { example.run } }

  it "activates a ready live interview without an opening and returns a scoped join token" do
    revision = interview.revision
    result = described_class.call(interview: interview)
    expect(result).to be_success
    interview.reload
    expect(interview).to have_attributes(status: "active", revision: revision + 1)
    expect(interview.messages).to be_empty
    expect(interview.operations.where(kind: "speech")).to be_empty
    connection = interview.live_connections.sole
    expect(connection).to have_attributes(status: "authorized", billed_seconds: 0, end_reason: nil)
    expect(connection.room_name).to start_with("interview-#{interview.id}-")
    expect(connection.room_name.length).to be > "interview-#{interview.id}-".length + 15
    value = result.value
    expect(value).to include(url: "wss://live.example.test", room_name: connection.room_name)
    claims = decode_livekit_token(value[:token])
    expect(claims).to include("iss" => "test-key", "sub" => "user-#{user.id}")
    expect(claims["exp"] - Time.current.to_i).to be_between(540, 600)
    expect(Time.zone.at(claims["exp"])).to be_within(1.second).of(value[:expires_at])
    expect(claims["video"]).to eq("roomJoin" => true, "room" => connection.room_name)
    agents = claims.dig("roomConfig", "agents")
    expect(agents.map { |agent| agent["agentName"] }).to eq([ Interviews::JoinLiveService::AGENT_NAME ])
    # The ai-live worker registers under this exact name (services/ai/tests/test_live_interview_agent.py
    # pins the same literal); a rename on one side would leave every live room without an interviewer.
    expect(Interviews::JoinLiveService::AGENT_NAME).to eq("careerdrafter-live-interviewer")
    expect(JSON.parse(agents.first["metadata"])).to eq("interview_session_id" => interview.id, "live_connection_id" => connection.id)
  end

  it "reuses the open connection on a repeat join with a fresh token" do
    first = described_class.call(interview: interview).value
    travel 2.seconds do
      second = described_class.call(interview: interview.reload).value
      expect(second[:room_name]).to eq(first[:room_name])
      expect(second[:token]).not_to eq(first[:token])
    end
    expect(interview.live_connections.count).to eq(1)
    interview.live_connections.sole.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
    third = described_class.call(interview: interview.reload).value
    expect(third[:room_name]).not_to eq(first[:room_name])
    expect(interview.live_connections.count).to eq(2)
  end

  it "allows only one open connection per session in the database" do
    described_class.call(interview: interview)
    expect { interview.live_connections.create!(room_name: "interview-#{interview.id}-other", status: "authorized") }
      .to raise_error(ActiveRecord::RecordNotUnique)
  end

  it "refuses turn-based and finished interviews without creating a room" do
    turn_based = ready_live_interview(user, conversation_mode: "turn_based")
    expect(described_class.call(interview: turn_based).errors).to eq([ "This interview is not a live interview" ])
    %w[preparing completed abandoned expired].each do |status|
      interview.update_columns(status: status)
      expect(described_class.call(interview: interview)).not_to be_success
    end
    interview.update_columns(status: "ready", expires_at: 1.second.ago)
    expect(described_class.call(interview: interview).errors).to eq([ "Interview expired" ])
    expect(InterviewLiveConnection.count).to eq(0)
  end

  it "refuses a new room for a saved-job interview whose job was deleted, but lets the open room be rejoined" do
    # A saved-job interview whose job was deleted (deletion detaches it).
    InterviewSession.where(id: interview.id).update_all(preparation_kind: "saved_job", job_id: nil)
    result = described_class.call(interview: interview.reload)
    expect(result).not_to be_success
    expect(result.errors.first).to start_with("The saved job for this interview was deleted")
    expect(interview.reload.live_connections).to be_empty
    expect(interview.status).to eq("ready")

    interview.update_columns(status: "active")
    interview.live_connections.create!(room_name: "interview-#{interview.id}-open")
    expect(described_class.call(interview: interview.reload)).to be_success
  end

  it "fails clearly when LiveKit is not configured, leaving the interview ready" do
    with_livekit_env("LIVEKIT_URL" => nil, "LIVEKIT_API_KEY" => "test-key", "LIVEKIT_API_SECRET" => "") do
      result = described_class.call(interview: interview)
      expect(result.errors.join).to include("LIVEKIT_URL", "LIVEKIT_API_SECRET")
    end
    expect(interview.reload.status).to eq("ready")
    expect(interview.live_connections).to be_empty
  end

  it "removes live connections with their session" do
    described_class.call(interview: interview)
    interview.destroy!
    expect(InterviewLiveConnection.count).to eq(0)
  end
end

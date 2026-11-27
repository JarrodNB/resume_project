# The live agent's private Rails callbacks: claiming its dispatched connection and saving each
# question opening as it is spoken. Both are safe to repeat; stale or foreign calls are refused.
require "rails_helper"

RSpec.describe "Internal live interview connections", type: :request do
  let(:user) { create(:user, summary: "I maintain laboratory instruments.") }
  let(:interview) { ready_live_interview(user) }
  let(:connection) do
    with_livekit_env { Interviews::JoinLiveService.call(interview: interview) }
    interview.reload.live_connections.sole
  end
  let(:headers) { { "Authorization" => "Bearer live-test" } }
  let(:base) { "/internal/interviews/live_connections/#{connection.id}" }
  let(:opening_text) { "Hi, thanks for joining. Let's start: Laboratory question 0?" }

  around do |example|
    original = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "live-test"
    example.run
  ensure
    ENV["INTERVIEW_SERVICE_SECRET"] = original
  end

  def claim(room_name: connection.room_name)
    post "#{base}/claim", params: { room_name: room_name }, headers: headers, as: :json
  end

  def prompt_asked(**overrides)
    post "#{base}/prompt_asked", params: { question_position: 0, kind: "opening", text: opening_text }.merge(overrides),
      headers: headers, as: :json
  end

  describe "claim" do
    it "requires the service secret" do
      post "#{base}/claim", params: { room_name: connection.room_name }, as: :json
      expect(response).to have_http_status(:unauthorized)
      expect(connection.reload.status).to eq("authorized")
    end

    it "marks the connection connected once and returns only identities and limits" do
      freeze_time do
        claim
        expect(response).to have_http_status(:ok)
        expect(response.headers["Cache-Control"]).to eq("no-store")
        expect(response.parsed_body).to eq(
          "interview_session_id" => interview.id, "live_connection_id" => connection.id, "user_id" => user.id,
          "question_total" => 8, "current_question_position" => 0
        )
        expect(connection.reload).to have_attributes(status: "connected", connected_at: Time.current, last_heartbeat_at: Time.current)
      end
      first_connected_at = connection.connected_at
      travel 5.seconds do
        claim
        expect(response).to have_http_status(:ok)
        expect(connection.reload.connected_at).to eq(first_connected_at)
        expect(connection.last_heartbeat_at).to be > first_connected_at
      end
    end

    it "refuses a foreign room, an ended connection and a finished session" do
      claim(room_name: "interview-someone-else")
      expect(response).to have_http_status(:conflict)
      expect(connection.reload.status).to eq("authorized")

      connection.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
      claim
      expect(response).to have_http_status(:conflict)
      expect(connection.reload.status).to eq("ended")

      connection.update!(status: "authorized", ended_at: nil, end_reason: nil)
      interview.update_columns(status: "completed")
      claim
      expect(response).to have_http_status(:conflict)
    end

    it "returns not found for an unknown connection" do
      post "/internal/interviews/live_connections/#{SecureRandom.uuid}/claim", params: { room_name: "room" }, headers: headers, as: :json
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "prompt_asked" do
    it "saves the spoken opening for the current question once and publishes the snapshot" do
      claim
      revision = interview.reload.revision
      expect(Interviews::PublishSnapshotService).to receive(:call).with(interview_id: interview.id).at_least(:once).and_call_original
      prompt_asked
      expect(response).to have_http_status(:ok)
      message = interview.messages.sole
      question = interview.questions.find_by!(position: 0)
      expect(message).to have_attributes(kind: "opening", question_id: question.id, position: 0,
        semantic_key: "question:#{question.id}:opening", content: opening_text, acknowledgement: nil)
      expect(response.parsed_body).to eq("message_id" => message.id, "question_position" => 0, "revision" => revision + 1)
      expect(interview.reload.revision).to eq(revision + 1)

      prompt_asked(text: "A different retelling of the question.")
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("message_id" => message.id, "question_position" => 0, "revision" => revision + 1)
      expect(interview.messages.sole.content).to eq(opening_text)
      expect(interview.reload.revision).to eq(revision + 1)
    end

    it "lets the saved opening request career references like a turn-based prompt" do
      allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: true))
      claim
      prompt_asked
      message = interview.messages.sole
      result = Interviews::CurrentPromptWork::References.new.request(interview: interview.reload, message_id: message.id)
      expect(result).to be_success
      expect(result.value.message).to eq(message)
    end

    it "refuses stale, unsupported or invalid prompts without saving" do
      prompt_asked
      expect(response).to have_http_status(:conflict) # not yet claimed

      claim
      prompt_asked(question_position: 1)
      expect(response).to have_http_status(:conflict)
      prompt_asked(kind: "follow_up")
      expect(response).to have_http_status(:conflict)
      prompt_asked(text: "   ")
      expect(response).to have_http_status(:conflict)
      prompt_asked(text: "x" * (TextLimits::PROSE + 1))
      expect(response).to have_http_status(:conflict)

      connection.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
      prompt_asked
      expect(response).to have_http_status(:conflict)
      expect(interview.messages).to be_empty
    end
  end
end

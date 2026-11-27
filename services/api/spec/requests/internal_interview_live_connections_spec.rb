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

  def answer_finished(prompt_message_id:, transcript: "I rebuilt the calibration schedule.")
    post "#{base}/answer_finished", params: { prompt_message_id: prompt_message_id, transcript: transcript },
      headers: headers, as: :json
  end

  def asked_opening
    claim
    prompt_asked
    response.parsed_body.fetch("message_id")
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
    it "saves the current question's prepared opening once (not the spoken words) and publishes the snapshot" do
      claim
      revision = interview.reload.revision
      expect(Interviews::PublishSnapshotService).to receive(:call).with(interview_id: interview.id).at_least(:once).and_call_original
      prompt_asked
      expect(response).to have_http_status(:ok)
      message = interview.messages.sole
      question = interview.questions.find_by!(position: 0)
      expect(message).to have_attributes(kind: "opening", question_id: question.id, position: 0,
        semantic_key: "question:#{question.id}:opening", content: question.content, acknowledgement: nil)
      expect(response.parsed_body).to eq("message_id" => message.id, "question_position" => 0, "revision" => revision + 1)
      expect(interview.reload.revision).to eq(revision + 1)

      prompt_asked(text: "A different retelling of the question.")
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("message_id" => message.id, "question_position" => 0, "revision" => revision + 1)
      expect(interview.messages.sole.content).to eq("Laboratory question 0?")
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
      prompt_asked(kind: "closing")
      expect(response).to have_http_status(:conflict)

      connection.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
      prompt_asked
      expect(response).to have_http_status(:conflict)
      expect(interview.messages).to be_empty
    end
  end

  describe "prompt_asked follow-ups" do
    def follow_up(text: "What did you change first?", prompt_key: SecureRandom.uuid)
      prompt_asked(kind: "follow_up", text: text, prompt_key: prompt_key)
    end

    before { interview.update_columns(answer_cap: 2) }

    it "saves the spoken follow-up after the latest answer, once per prompt key" do
      opening_id = asked_opening
      answer_finished(prompt_message_id: opening_id)
      revision = interview.reload.revision
      follow_up(text: "  What did you change first?  ", prompt_key: "key-1")
      expect(response).to have_http_status(:ok)
      message = interview.messages.follow_up.sole
      expect(message).to have_attributes(question_id: interview.questions.find_by!(position: 0).id, position: 2,
        content: "What did you change first?", semantic_key: "live_prompt:key-1")
      expect(response.parsed_body).to eq("message_id" => message.id, "question_position" => 0, "revision" => revision + 1)
      follow_up(text: "A retold follow-up.", prompt_key: "key-1")
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["message_id"]).to eq(message.id)
      expect(interview.messages.follow_up.sole.content).to eq("What did you change first?")
      expect(interview.reload.revision).to eq(revision + 1)
    end

    it "refuses a follow-up before the latest prompt is answered or once the answer cap is reached" do
      opening_id = asked_opening
      follow_up
      expect(response).to have_http_status(:conflict)
      answer_finished(prompt_message_id: opening_id)
      follow_up(prompt_key: "first")
      follow_up_id = response.parsed_body.fetch("message_id")
      follow_up(prompt_key: "second")
      expect(response).to have_http_status(:conflict) # the follow-up has no answer yet
      answer_finished(prompt_message_id: follow_up_id)
      expect(interview.questions.find_by!(position: 0).accepted_answer_count).to eq(2)
      follow_up(prompt_key: "third")
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["errors"]).to eq([ "No more follow-ups for this question" ])
      expect(interview.messages.follow_up.count).to eq(1)
    end

    it "refuses a blank, oversized or keyless follow-up" do
      answer_finished(prompt_message_id: asked_opening)
      follow_up(text: "   ")
      expect(response).to have_http_status(:conflict)
      follow_up(text: "x" * (TextLimits::PROSE + 1))
      expect(response).to have_http_status(:conflict)
      follow_up(prompt_key: "")
      expect(response).to have_http_status(:conflict)
      follow_up(prompt_key: "k" * 101)
      expect(response).to have_http_status(:conflict)
      expect(interview.messages.follow_up).to be_empty
    end
  end

  describe "answer_finished" do
    it "saves the answer to the prompt once, counts it and publishes the snapshot" do
      opening_id = asked_opening
      revision = interview.reload.revision
      expect(Interviews::PublishSnapshotService).to receive(:call).with(interview_id: interview.id).at_least(:once).and_call_original
      answer_finished(prompt_message_id: opening_id, transcript: "  I rebuilt the calibration schedule.  ")
      expect(response).to have_http_status(:ok)
      answer = interview.messages.answer.sole
      question = interview.questions.find_by!(position: 0)
      expect(answer).to have_attributes(question_id: question.id, position: 1, content: "I rebuilt the calibration schedule.",
        semantic_key: "live_answer:#{opening_id}")
      expect(response.parsed_body).to eq("message_id" => answer.id, "question_position" => 0,
        "accepted_answer_count" => 1, "revision" => revision + 1)
      expect(question.reload.accepted_answer_count).to eq(1)
    end

    it "replaces the saved answer to the same prompt without counting it again (latest wins)" do
      opening_id = asked_opening
      answer_finished(prompt_message_id: opening_id, transcript: "First try.")
      first = interview.messages.answer.sole
      answer_finished(prompt_message_id: opening_id, transcript: "A better second try.")
      expect(response).to have_http_status(:ok)
      expect(interview.messages.answer.sole).to have_attributes(id: first.id, position: first.position, content: "A better second try.")
      expect(interview.questions.find_by!(position: 0).accepted_answer_count).to eq(1)
      revision = interview.reload.revision
      answer_finished(prompt_message_id: opening_id, transcript: "A better second try.")
      expect(response).to have_http_status(:ok)
      expect(interview.reload.revision).to eq(revision)
    end

    it "refuses blank, oversized, unknown or non-current prompts and ended connections without saving" do
      opening_id = asked_opening
      answer_finished(prompt_message_id: opening_id, transcript: "   ")
      expect(response).to have_http_status(:conflict)
      answer_finished(prompt_message_id: opening_id, transcript: "x" * (TextLimits::PROSE + 1))
      expect(response).to have_http_status(:conflict)
      answer_finished(prompt_message_id: SecureRandom.uuid)
      expect(response).to have_http_status(:conflict)
      other = ready_live_interview(user)
      foreign = other.messages.create!(question: other.questions.first, kind: "opening", position: 0,
        semantic_key: "question:#{other.questions.first.id}:opening", content: "Other?")
      answer_finished(prompt_message_id: foreign.id)
      expect(response).to have_http_status(:conflict)
      interview.update_columns(current_question_position: 1)
      answer_finished(prompt_message_id: opening_id)
      expect(response).to have_http_status(:conflict)
      interview.update_columns(current_question_position: 0)
      connection.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
      answer_finished(prompt_message_id: opening_id)
      expect(response).to have_http_status(:conflict)
      expect(interview.messages.answer).to be_empty
      expect(interview.questions.find_by!(position: 0).accepted_answer_count).to eq(0)
    end
  end

  describe "question_advanced" do
    def question_advanced(question_position)
      post "#{base}/question_advanced", params: { question_position: question_position }, headers: headers, as: :json
    end

    it "moves an answered question on like turn-based acceptance, saving the next opening once" do
      answer_finished(prompt_message_id: asked_opening)
      revision = interview.reload.revision
      question_advanced(0)
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("current_question_position" => 1, "revision" => revision + 1)
      interview.reload
      expect(interview).to have_attributes(current_question_position: 1, status: "active")
      expect(interview.questions.find_by!(position: 0).skipped_at).to be_nil
      second = interview.questions.find_by!(position: 1)
      opening = interview.messages.find_by!(question: second, kind: "opening")
      expect(opening).to have_attributes(content: second.content, semantic_key: "question:#{second.id}:opening")

      question_advanced(0) # a retried report of the same move changes nothing
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("current_question_position" => 1, "revision" => revision + 1)
      prompt_asked(question_position: 1)
      expect(response.parsed_body["message_id"]).to eq(opening.id)
    end

    it "skips a question that has no answer" do
      claim
      prompt_asked
      question_advanced(0)
      expect(response).to have_http_status(:ok)
      expect(interview.questions.find_by!(position: 0).skipped_at).to be_present
      expect(interview.reload.current_question_position).to eq(1)
    end

    it "stays on the last question without completing the interview" do
      claim
      interview.update_columns(current_question_position: 7)
      question_advanced(7)
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["current_question_position"]).to eq(7)
      expect(interview.reload).to have_attributes(status: "active", current_question_position: 7)
      expect(interview.questions.find_by!(position: 7).skipped_at).to be_present
      revision = interview.revision
      question_advanced(7)
      expect(response).to have_http_status(:ok)
      expect(interview.reload.revision).to eq(revision)
    end

    it "refuses a question that is not current and an ended connection" do
      claim
      question_advanced(3)
      expect(response).to have_http_status(:conflict)
      connection.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
      question_advanced(0)
      expect(response).to have_http_status(:conflict)
      expect(interview.reload.current_question_position).to eq(0)
    end
  end
end

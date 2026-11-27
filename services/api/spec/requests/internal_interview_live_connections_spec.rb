# The live agent's private Rails callbacks: claiming its dispatched connection, saving prompts,
# answers and spoken feedback as they happen, restarting a question, moving between questions and
# finishing. All are safe to repeat; stale or foreign calls are refused with 409 and change nothing,
# and malformed ones with 422 `invalid_request`.
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
          "question_total" => 8, "current_question_position" => 0, "answer_cap" => interview.answer_cap,
          "current_question_retry_count" => 0, "session_seconds_left" => 1_500, "allowance_seconds_left" => 600,
          "heartbeat_sequence" => 0, "current_prompt_message_id" => nil, "current_prompt_kind" => nil,
          "current_prompt_answered" => false, "current_question_answer_count" => 0, "current_question_feedback_given" => false
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
      interview.questions.find_by!(position: 0).update!(live_retry_count: 2)
      claim # a restarted agent learns the retries the current question already used
      expect(response.parsed_body["current_question_retry_count"]).to eq(2)
    end

    it "tells a fresh agent that takes over where the current question stands, with no text" do
      interview.update_columns(answer_cap: 2)
      opening_id = asked_opening
      claim
      expect(response.parsed_body).to include("current_prompt_message_id" => opening_id, "current_prompt_kind" => "opening",
        "current_prompt_answered" => false, "current_question_answer_count" => 0, "current_question_feedback_given" => false)
      answer_finished(prompt_message_id: opening_id)
      prompt_asked(kind: "follow_up", text: "What changed?", prompt_key: "q0-r0-f1")
      follow_up_id = response.parsed_body.fetch("message_id")
      post "#{base}/heartbeat", params: { sequence: 3, billed_seconds_delta: 30, usage: [] }, headers: headers, as: :json
      claim
      expect(response.parsed_body).to include("heartbeat_sequence" => 3, "current_prompt_message_id" => follow_up_id,
        "current_prompt_kind" => "follow_up", "current_prompt_answered" => false, "current_question_answer_count" => 1)
      answer_finished(prompt_message_id: follow_up_id, transcript: "Fewer failed runs.")
      post "#{base}/feedback_given", params: { question_position: 0, text: "Quick feedback: clear." }, headers: headers, as: :json
      claim
      expect(response.parsed_body).to include("current_prompt_answered" => true, "current_question_answer_count" => 2,
        "current_question_feedback_given" => true)
      expect(response.parsed_body.values.grep(String)).not_to include(a_string_including("changed", "Fewer", "Quick"))
    end

    it "opens one live conversation bill per connection: a task, a reserved observation and an unfinished usage report" do
      claim
      claim
      task = connection.reload.ai_task
      expect(task).to have_attributes(user_id: user.id, task_type: "interview_live_conversation", subject: interview,
        hourly_admission_task: interview.operations.preparation.first.ai_task, cost_microdollars: 0)
      expect(user.ai_tasks.where(task_type: "interview_live_conversation").count).to eq(1)
      expect(InterviewVerificationReservation.find_by!(observation_id: connection.observation_id))
        .to have_attributes(reserved_microdollars: 2_000_000, actual_microdollars: nil)
      expect(task.ai_usage_attempts.sole).to have_attributes(attempt_id: connection.observation_id, finalized: false, incomplete: true)
    end

    it "is not stopped by the hidden daily spend cap; the live allowance is its limit" do
      connection # prepared and joined before the cap is spent
      user.update!(daily_ai_spend_cap_microdollars: 1)
      user.ai_tasks.create!(task_type: "interview_turn", cost_microdollars: 10, status: "completed")
      claim
      expect(response).to have_http_status(:ok)
      expect(connection.reload.ai_task).to be_present
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
      expect(response).to have_http_status(:unprocessable_content)

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
      expect(response.parsed_body).to eq("errors" => [ "No more follow-ups for this question" ]) # no connection_ended code
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

    # The live agent cuts longer answers to this limit before reporting them
    # (services/ai/tests/test_live_interview_controller.py pins ANSWER_LIMIT to the same number).
    it "accepts an answer of exactly 4,000 characters, the live agent's limit" do
      expect(TextLimits::PROSE).to eq(4_000)
      opening_id = asked_opening
      answer_finished(prompt_message_id: opening_id, transcript: "x" * 4_000)
      expect(response).to have_http_status(:ok)
      expect(interview.messages.answer.sole.content.length).to eq(4_000)
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

  describe "feedback_given" do
    def feedback_given(text: "Quick feedback: clear example. Next time, say the result first.", question_position: 0)
      post "#{base}/feedback_given", params: { question_position: question_position, text: text }, headers: headers, as: :json
    end

    it "saves the current question's spoken feedback, replaces it later and publishes the snapshot" do
      answer_finished(prompt_message_id: asked_opening)
      revision = interview.reload.revision
      expect(Interviews::PublishSnapshotService).to receive(:call).with(interview_id: interview.id).at_least(:once).and_call_original
      feedback_given(text: "  Quick feedback: clear example.  ")
      expect(response).to have_http_status(:ok)
      question = interview.questions.find_by!(position: 0)
      expect(question.reload.live_feedback).to eq("Quick feedback: clear example.")
      expect(response.parsed_body).to eq("question_position" => 0, "revision" => revision + 1)

      feedback_given(text: "Quick feedback: clear example.") # a retried report changes nothing
      expect(interview.reload.revision).to eq(revision + 1)
      feedback_given(text: "Quick feedback: better now. Keep it shorter.")
      expect(response).to have_http_status(:ok)
      expect(question.reload.live_feedback).to eq("Quick feedback: better now. Keep it shorter.")
      expect(interview.reload.revision).to eq(revision + 2)
    end

    it "accepts feedback of exactly 1,500 characters, the live agent's limit" do
      # services/ai/tests/test_live_interview_controller.py pins the agent's FEEDBACK_LIMIT to the same number.
      expect(InterviewSessionQuestion::LIVE_FEEDBACK_LIMIT).to eq(1_500)
      claim
      prompt_asked
      feedback_given(text: "x" * 1_500)
      expect(response).to have_http_status(:ok)
      expect(interview.questions.find_by!(position: 0).live_feedback.length).to eq(1_500)
    end

    it "refuses blank, oversized or non-current feedback and ended connections without saving" do
      feedback_given
      expect(response).to have_http_status(:conflict) # not yet claimed
      claim
      prompt_asked
      feedback_given(text: "   ")
      expect(response).to have_http_status(:conflict)
      feedback_given(text: "x" * (InterviewSessionQuestion::LIVE_FEEDBACK_LIMIT + 1))
      expect(response).to have_http_status(:conflict)
      feedback_given(question_position: 1)
      expect(response).to have_http_status(:conflict)
      connection.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
      feedback_given
      expect(response).to have_http_status(:conflict)
      expect(interview.questions.where.not(live_feedback: nil)).to be_empty
    end
  end

  describe "question_retried" do
    def question_retried(retry_number, question_position: 0)
      post "#{base}/question_retried", params: { question_position: question_position, retry_number: retry_number },
        headers: headers, as: :json
    end

    def answered_question_with_follow_up
      interview.update_columns(answer_cap: 2)
      opening_id = asked_opening
      answer_finished(prompt_message_id: opening_id, transcript: "First try.")
      prompt_asked(kind: "follow_up", text: "What changed?", prompt_key: SecureRandom.uuid)
      follow_up_id = response.parsed_body.fetch("message_id")
      answer_finished(prompt_message_id: follow_up_id, transcript: "Not much.")
      post "#{base}/feedback_given", params: { question_position: 0, text: "Quick feedback: add a result." }, headers: headers, as: :json
      [ opening_id, follow_up_id ]
    end

    it "removes the question's answers, follow-ups and feedback so the next attempt replaces them" do
      opening_id, follow_up_id = answered_question_with_follow_up
      allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: true))
      references = Interviews::CurrentPromptWork::References.new
      kept = interview.career_references.create!(message_id: opening_id) # requested while the opening was current
      removed = references.request(interview: interview.reload, message_id: follow_up_id).value
      revision = interview.reload.revision
      question_retried(1)
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("question_position" => 0, "retry_count" => 1, "revision" => revision + 1)
      question = interview.questions.find_by!(position: 0)
      expect(question.reload).to have_attributes(accepted_answer_count: 0, live_feedback: nil, live_retry_count: 1)
      expect(interview.messages.where(question: question).pluck(:id)).to eq([ opening_id ])
      expect(InterviewCareerReferences.where(id: removed.id)).to be_empty
      expect(removed.ai_task.reload.status).to eq("failed")
      expect(kept.reload.message_id).to eq(opening_id)

      question_retried(1) # a retried report of the same retry does not clear the new attempt
      answer_finished(prompt_message_id: opening_id, transcript: "A better second try.")
      question_retried(1)
      expect(response).to have_http_status(:ok)
      expect(interview.messages.answer.sole.content).to eq("A better second try.")
      expect(question.reload.accepted_answer_count).to eq(1)
    end

    it "allows two retries per question and refuses a third or a skipped number" do
      answered_question_with_follow_up
      question_retried(2)
      expect(response).to have_http_status(:conflict)
      question_retried(1)
      question_retried(2)
      expect(response).to have_http_status(:ok)
      question_retried(3)
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["errors"]).to eq([ "This question has no retries left" ])
      expect(interview.questions.find_by!(position: 0).live_retry_count).to eq(2)
    end

    it "refuses a question that is not current and an ended connection" do
      claim
      question_retried(1, question_position: 1)
      expect(response).to have_http_status(:conflict)
      connection.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
      question_retried(1)
      expect(response).to have_http_status(:conflict)
      expect(interview.questions.find_by!(position: 0).live_retry_count).to eq(0)
    end
  end

  describe "heartbeat" do
    let(:realtime_usage) do
      { model: "gpt-realtime-2.1-mini", input_tokens: 1_000, cached_input_tokens: 400, output_tokens: 300, cost_microdollars: 9_000 }
    end

    def heartbeat(sequence, billed_seconds_delta: 30, usage: [ realtime_usage ])
      post "#{base}/heartbeat", params: { sequence: sequence, billed_seconds_delta: billed_seconds_delta, usage: usage },
        headers: headers, as: :json
    end

    it "adds billed seconds and usage once per sequence, replays a repeat and refuses an older one" do
      claim
      travel 30.seconds do
        heartbeat(1)
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body).to eq("action" => "continue", "allowance_seconds_left" => 570, "session_seconds_left" => 1_470)
        expect(connection.reload).to have_attributes(billed_seconds: 30, heartbeat_sequence: 1, last_heartbeat_at: Time.current)
      end
      receipt = response.parsed_body
      heartbeat(1)
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq(receipt)
      heartbeat(2, billed_seconds_delta: 12, usage: [ realtime_usage, { model: "gpt-live-transcribe", audio_milliseconds: 12_000, cost_microdollars: 3_400 } ])
      heartbeat(1)
      expect(response).to have_http_status(:conflict)
      expect(connection.reload).to have_attributes(billed_seconds: 42, heartbeat_sequence: 2)
      task = connection.ai_task.reload
      expect(task).to have_attributes(input_tokens: 2_000, cached_input_tokens: 800, output_tokens: 600, cost_microdollars: 21_400)
      expect(AiUsage::AttemptEntries.as_hashes(task.ai_usage_attempts.sole)).to contain_exactly(
        { "stage" => "live_conversation", "provider" => "openai", "model" => "gpt-realtime-2.1-mini", "input_tokens" => 2_000,
          "cached_input_tokens" => 800, "output_tokens" => 600, "cost_microdollars" => 18_000 },
        { "stage" => "live_conversation", "provider" => "openai", "model" => "gpt-live-transcribe", "audio_milliseconds" => 12_000,
          "cost_microdollars" => 3_400 }
      )
      expect(AiUsage::DailySpend.known_microdollars(user)).to eq(user.ai_tasks.where.not(id: task.id).sum(:cost_microdollars))
    end

    it "keeps live costs out of the hidden daily cap, so other AI work can still start the same day" do
      claim
      heartbeat(1, billed_seconds_delta: 12, usage: [ realtime_usage ])
      expect(connection.reload.ai_task.cost_microdollars).to eq(9_000)
      user.update!(daily_ai_spend_cap_microdollars: 9_000)
      stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 30)

      expect(Interviews::StartPreparationService.call(user: user)).to be_success
      expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).to be_success
    end

    it "warns at 2 minutes of live allowance left and says wrap up with the reason once it runs out" do
      claim
      heartbeat(1, billed_seconds_delta: 470)
      expect(response.parsed_body).to include("action" => "continue", "allowance_seconds_left" => 130)
      heartbeat(2, billed_seconds_delta: 10)
      expect(response.parsed_body).to include("action" => "warn", "allowance_seconds_left" => 120)
      heartbeat(3, billed_seconds_delta: 120)
      expect(response.parsed_body).to eq("action" => "wrap_up", "reason" => "allowance", "allowance_seconds_left" => 0, "session_seconds_left" => 900)
    end

    it "says wrap up with time_limit once the session's 25 counted minutes are used" do
      create(:billing_subscription, user: user)
      claim
      heartbeat(1, billed_seconds_delta: 1_500)
      expect(response.parsed_body).to eq("action" => "wrap_up", "reason" => "time_limit", "allowance_seconds_left" => 2_100, "session_seconds_left" => 0)
    end

    it "says wrap up with time_limit once the connection has been open 45 minutes, however little was counted" do
      create(:billing_subscription, user: user)
      claim
      travel(Interviews::LiveAllowance::CONNECTION_WALL_CLOCK - 1.second) do
        heartbeat(1, billed_seconds_delta: 0)
        expect(response.parsed_body).to include("action" => "continue")
      end
      travel(Interviews::LiveAllowance::CONNECTION_WALL_CLOCK + 1.second) do # travel drops sub-seconds
        heartbeat(2, billed_seconds_delta: 0)
        expect(response.parsed_body).to eq("action" => "wrap_up", "reason" => "time_limit", "allowance_seconds_left" => 3_600,
          "session_seconds_left" => 1_500)
      end
    end

    it "keeps an unpriced usage report unknown rather than free" do
      claim
      heartbeat(1, usage: [ realtime_usage.except(:cost_microdollars) ])
      expect(response).to have_http_status(:ok)
      entry = AiUsage::AttemptEntries.as_hashes(connection.reload.ai_task.ai_usage_attempts.sole).sole
      expect(entry).to include("input_tokens" => 1_000)
      expect(entry).not_to have_key("cost_microdollars")
      heartbeat(2)
      expect(AiUsage::AttemptEntries.as_hashes(connection.ai_task.ai_usage_attempts.sole).sole).not_to have_key("cost_microdollars")
    end

    it "refuses usage for a model it does not bill with a distinct code, without changes" do
      claim
      heartbeat(1, usage: [ realtime_usage.merge(model: "gpt-realtime-9") ])
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body).to include("code" => "unknown_usage_model")
      expect(connection.reload).to have_attributes(billed_seconds: 0, heartbeat_sequence: 0)
    end

    it "refuses an unclaimed or ended connection and invalid reports without changes" do
      heartbeat(1)
      expect(response).to have_http_status(:conflict)
      claim
      [ { sequence: 0 }, { billed_seconds_delta: -1 }, { billed_seconds_delta: 2_000 },
        { usage: [ realtime_usage.merge(input_tokens: -5) ] }, { usage: [ realtime_usage.merge(prompt: "text") ] }, { usage: "lots" } ].each do |invalid|
        post "#{base}/heartbeat", params: { sequence: 1, billed_seconds_delta: 30, usage: [ realtime_usage ] }.merge(invalid), headers: headers, as: :json
        expect(response).to have_http_status(:unprocessable_content)
        expect(response.parsed_body).to include("code" => "invalid_request")
      end
      heartbeat(1, usage: [ realtime_usage.merge(model: "gpt-6-luna") ])
      expect(response.parsed_body).to include("code" => "unknown_usage_model")
      expect(connection.reload).to have_attributes(billed_seconds: 0, heartbeat_sequence: 0)
      connection.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
      heartbeat(1)
      expect(response).to have_http_status(:conflict)
    end
  end

  describe "after the connection or session is over" do
    def heartbeat(sequence)
      post "#{base}/heartbeat", params: { sequence: sequence, billed_seconds_delta: 1, usage: [] }, headers: headers, as: :json
    end

    it "refuses every agent callback with the connection_ended code once recovery or the owner ended the connection" do
      opening_id = asked_opening
      answer_finished(prompt_message_id: opening_id)
      expect(Interviews::FinishLiveService.call(connection: connection, reason: "disconnected")).to be_success

      heartbeat(1)
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body).to include("code" => "connection_ended")
      answer_finished(prompt_message_id: opening_id, transcript: "Something new.")
      expect(response.parsed_body).to include("code" => "connection_ended")
      prompt_asked(kind: "follow_up", text: "Why?", prompt_key: "late")
      expect(response.parsed_body).to include("code" => "connection_ended")
      post "#{base}/question_advanced", params: { question_position: 0 }, headers: headers, as: :json
      expect(response.parsed_body).to include("code" => "connection_ended")
    end

    it "uses the same code when the session itself is no longer active" do
      claim
      interview.update_columns(status: "abandoned")
      heartbeat(1)
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body).to include("code" => "connection_ended")
    end
  end

  describe "finish" do
    def finish(reason, **extra)
      post "#{base}/finish", params: { reason: reason, **extra }, headers: headers, as: :json
    end

    it "finishes at the time limit or when the allowance runs out by the same completed/abandoned rule" do
      answer_finished(prompt_message_id: asked_opening)
      finish("time_limit")
      expect(response.parsed_body).to include("status" => "completed", "end_reason" => "time_limit")
      other = ready_live_interview(user)
      with_livekit_env { Interviews::JoinLiveService.call(interview: other) }
      other_connection = other.reload.live_connections.sole
      post "/internal/interviews/live_connections/#{other_connection.id}/claim", params: { room_name: other_connection.room_name }, headers: headers, as: :json
      post "/internal/interviews/live_connections/#{other_connection.id}/finish", params: { reason: "allowance" }, headers: headers, as: :json
      expect(response.parsed_body).to include("status" => "abandoned", "end_reason" => "allowance")
    end

    it "closes the bill as known when the agent's final heartbeat was the last one applied" do
      answer_finished(prompt_message_id: asked_opening)
      post "#{base}/heartbeat", params: { sequence: 1, billed_seconds_delta: 30, usage: [ { model: "gpt-realtime-2.1-mini",
        input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, cost_microdollars: 120 } ] }, headers: headers, as: :json
      finish("completed", final_sequence: 1)
      task = connection.reload.ai_task
      expect(task).to have_attributes(status: "completed", cost_microdollars: 120)
      expect(task.ai_usage_attempts.sole).to have_attributes(finalized: true, incomplete: false)
      expect(InterviewVerificationReservation.find_by!(observation_id: connection.observation_id).actual_microdollars).to eq(120)
    end

    it "keeps the bill unknown after another agent took over, even when its final heartbeat matches" do
      answer_finished(prompt_message_id: asked_opening)
      claim # a fresh agent claims the already connected connection; the first agent's last usage is lost
      expect(response).to have_http_status(:ok)
      post "#{base}/heartbeat", params: { sequence: 1, billed_seconds_delta: 30, usage: [ { model: "gpt-realtime-2.1-mini",
        input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, cost_microdollars: 120 } ] }, headers: headers, as: :json
      finish("completed", final_sequence: 1)
      expect(connection.reload.ai_task.ai_usage_attempts.sole).to have_attributes(finalized: true, incomplete: true)
      expect(InterviewVerificationReservation.find_by!(observation_id: connection.observation_id).actual_microdollars).to be_nil
    end

    it "keeps the bill unknown when a final heartbeat is missing or the owner ends without the agent" do
      answer_finished(prompt_message_id: asked_opening)
      finish("completed", final_sequence: 3)
      report = connection.reload.ai_task.ai_usage_attempts.sole
      expect(report).to have_attributes(finalized: true, incomplete: true)
      expect(InterviewVerificationReservation.find_by!(observation_id: connection.observation_id).actual_microdollars).to be_nil
      expect(connection.ai_task.status).to eq("completed")
    end

    it "ends the connection and completes an interview that has an answer, once" do
      answer_finished(prompt_message_id: asked_opening)
      freeze_time do
        finish("completed")
        expect(response).to have_http_status(:ok)
        expect(connection.reload).to have_attributes(status: "ended", ended_at: Time.current, end_reason: "completed")
        expect(interview.reload).to have_attributes(status: "completed", completed_at: Time.current)
        expect(response.parsed_body).to eq("status" => "completed", "end_reason" => "completed", "revision" => interview.revision)
      end
      receipt = response.parsed_body
      finish("ended_by_candidate")
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq(receipt)
      expect(connection.reload.end_reason).to eq("completed")
    end

    it "abandons an interview that has no saved answer" do
      claim
      prompt_asked
      finish("ended_by_candidate")
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to include("status" => "abandoned", "end_reason" => "ended_by_candidate")
      expect(interview.reload.status).to eq("abandoned")
      expect(connection.reload.status).to eq("ended")
    end

    it "closes an idle menu with the idle reason by the same completed/abandoned rule" do
      answer_finished(prompt_message_id: asked_opening)
      finish("idle")
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to include("status" => "completed", "end_reason" => "idle")
      expect(connection.reload).to have_attributes(status: "ended", end_reason: "idle")
    end

    it "finishes a candidate who stayed away as disconnected by the same completed/abandoned rule" do
      answer_finished(prompt_message_id: asked_opening)
      finish("disconnected")
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to include("status" => "completed", "end_reason" => "disconnected")
    end

    it "refuses unknown reasons and an ended connection of a still-active interview" do
      claim
      finish("nonsense")
      expect(response).to have_http_status(:unprocessable_content)
      expect(connection.reload.status).to eq("connected")
      connection.update!(status: "ended", ended_at: Time.current, end_reason: "disconnected")
      finish("completed")
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body).to include("code" => "connection_ended") # the agent leaves, as for other callbacks
      expect(interview.reload.status).to eq("active")
    end

    it "refuses a finish for a session that is no longer active with the connection_ended code" do
      claim
      interview.update_columns(status: "abandoned")
      finish("completed")
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body).to include("code" => "connection_ended")
      expect(connection.reload.status).to eq("connected")
    end
  end

  it "refuses every callback after the claim while the connection is unclaimed, with no ended code" do
    [
      [ "prompt_asked", { question_position: 0, kind: "opening", text: "Hi." } ],
      [ "answer_finished", { prompt_message_id: SecureRandom.uuid, transcript: "An answer." } ],
      [ "question_advanced", { question_position: 0 } ],
      [ "feedback_given", { question_position: 0, text: "Quick feedback: good." } ],
      [ "question_retried", { question_position: 0, retry_number: 1 } ],
      [ "heartbeat", { sequence: 1, billed_seconds_delta: 30, usage: [] } ]
    ].each do |action, body|
      post "#{base}/#{action}", params: body, headers: headers, as: :json
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body).to eq("errors" => [ "The live agent has not claimed this connection" ])
    end
    expect(connection.reload.status).to eq("authorized")
  end

  describe "malformed requests" do
    def expect_invalid_request
      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to include("code" => "invalid_request")
    end

    it "refuses wrongly typed or missing parameters on every callback with invalid_request, without changes" do
      claim(room_name: 42)
      expect_invalid_request
      opening_id = asked_opening
      revision = interview.reload.revision
      [
        [ "prompt_asked", { question_position: "0", kind: "opening", text: "Hi." } ],
        [ "prompt_asked", { question_position: 0, kind: "closing", text: "Hi." } ],
        [ "prompt_asked", { question_position: 0, kind: "follow_up", text: [ "Why?" ], prompt_key: "k" } ],
        [ "answer_finished", { prompt_message_id: [ opening_id ], transcript: "An answer." } ],
        [ "answer_finished", { prompt_message_id: opening_id, transcript: { text: "An answer." } } ],
        [ "question_advanced", { question_position: "0" } ],
        [ "feedback_given", { question_position: 0.5, text: "Quick feedback: good." } ],
        [ "feedback_given", { question_position: 0, text: 7 } ],
        [ "question_retried", { question_position: 0, retry_number: "1" } ],
        [ "question_retried", { question_position: "0", retry_number: 1 } ],
        [ "heartbeat", { sequence: "1", billed_seconds_delta: 30, usage: [] } ],
        [ "heartbeat", { sequence: 1, billed_seconds_delta: 30, usage: "lots" } ],
        [ "finish", { reason: "nonsense" } ],
        [ "finish", { reason: "completed", final_sequence: "1" } ],
        [ "heartbeat", { billed_seconds_delta: 30, usage: [] } ]
      ].each do |action, body|
        post "#{base}/#{action}", params: body, headers: headers, as: :json
        expect_invalid_request
      end
      expect(interview.reload.revision).to eq(revision)
      expect(connection.reload).to have_attributes(status: "connected", heartbeat_sequence: 0)
      expect(interview.messages.answer).to be_empty
    end
  end

  it "runs a whole live interview whose completed session gets session feedback like a turn-based one" do
    allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: true))
    interview.update_columns(answer_cap: 2)
    answer_finished(prompt_message_id: asked_opening, transcript: "I rebuilt the calibration schedule.")
    prompt_asked(kind: "follow_up", text: "What changed for the team?", prompt_key: "q0-f1")
    answer_finished(prompt_message_id: response.parsed_body["message_id"], transcript: "Fewer failed runs.")
    post "#{base}/question_advanced", params: { question_position: 0 }, headers: headers, as: :json
    post "#{base}/finish", params: { reason: "completed" }, headers: headers, as: :json
    expect(response.parsed_body["status"]).to eq("completed")

    first = interview.reload.questions.find_by!(position: 0)
    expect(interview.messages.where(question: first).order(:position).pluck(:kind, :content)).to eq([
      [ "opening", first.content ], [ "answer", "I rebuilt the calibration schedule." ],
      [ "follow_up", "What changed for the team?" ], [ "answer", "Fewer failed runs." ]
    ])
    expect(interview.questions.find_by!(position: 1).skipped_at).to be_nil
    feedback = Interviews::SessionFeedback.new
    record = feedback.request(interview: interview).value
    expect(record).to be_persisted
    expect(feedback.claim(ai_task: record.ai_task).value).to include(allowed: true, interview_id: interview.id)
  end
end

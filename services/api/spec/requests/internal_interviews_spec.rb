# Service authentication is independent of browser sessions and supplied owner IDs.
require "rails_helper"

RSpec.describe "Internal interview execution", type: :request do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:operation) { interview.operations.first }
  let(:path) { "/internal/interviews/operations/#{operation.id}" }
  let(:headers) { { "Authorization" => "Bearer service-test" } }

  around do |example|
    original = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "service-test"
    example.run
  ensure
    ENV["INTERVIEW_SERVICE_SECRET"] = original
  end


  it "validates requested execution mode and filters real work for legacy callers" do
    # This legacy fixture's first operation is provider speech; discovery is
    # intentionally disabled for that operation in the default browser mode.
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_SPEECH_PLAYBACK").and_return("provider")
    real = Interviews::CreateFixtureService.call(user: interview.user, execution_mode: "real").value
    real_operation = real.operations.first
    get "/internal/interviews/operations", headers: headers
    expect(response.parsed_body["operation_ids"]).not_to include(real_operation.id)
    get "/internal/interviews/operations", params: { execution_mode: "real" }, headers: headers
    expect(response.parsed_body["operation_ids"]).to include(real_operation.id)
    get "/internal/interviews/operations", params: { execution_mode: "invalid" }, headers: headers
    expect(response).to have_http_status(:conflict)
    post "/internal/interviews/operations/#{real_operation.id}/claim", params: {}, headers: headers, as: :json
    expect(response).to have_http_status(:conflict)
    expect(real_operation.reload.execution_count).to eq(0)
    post "/internal/interviews/operations/#{real_operation.id}/claim", params: { execution_mode: "real" }, headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["execution_config"]).to eq(real.execution_config)
  end

  it "rejects missing credentials even with an owner ID" do
    post "#{path}/claim", params: { user_id: interview.user_id }, as: :json
    expect(response).to have_http_status(:unauthorized)
    expect(operation.reload).to be_pending
  end

  it "claims only persisted owner context and exposes a credential-free canonical status" do
    post "#{path}/claim", params: { user_id: SecureRandom.uuid }, headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.dig("payload", "text")).to eq(interview.messages.first.content)
    get path, headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.keys).not_to include("attempt_id", "claim_generation", "payload")
    expect(response.headers["Cache-Control"]).to eq("no-store")
  end

  it "bounds the internal callback body" do
    post "#{path}/claim", params: { ignored: "x" * 300_001 }, headers: headers, as: :json
    expect(response).to have_http_status(:content_too_large)
  end
end

RSpec.describe "Internal interview callbacks", type: :request do
  include Devise::Test::IntegrationHelpers
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:turn) do
    Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
      recording_id: ready_interview_recording(interview).id, expected_revision: 0, submission_key: "callback").value
  end
  let(:path) { "/internal/interviews/operations/#{turn.id}" }
  let(:headers) { { "Authorization" => "Bearer callback-test" } }
  around do |example|
    original = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "callback-test"
    example.run
  ensure
    ENV["INTERVIEW_SERVICE_SECRET"] = original
  end

  it "recovers a lost acceptance reply through identical replay and canonical status" do
    post "#{path}/claim", headers: headers, as: :json
    claim = response.parsed_body.slice("attempt_id", "claim_generation")
    payload = claim.merge(transcript: "I helped my team.", decision: "advance", history_version: 1, model_history: [])
    2.times do
      post "#{path}/accept", params: payload, headers: headers, as: :json
      expect(response).to have_http_status(:ok)
    end
    receipt = response.parsed_body
    get path, headers: headers
    expect(response.parsed_body["accepted_result"]).to eq(receipt)
    expect(interview.reload.revision).to eq(1)
    expect(turn.reload.ai_task).to be_completed
    expect(turn.ai_task.ai_usage_attempts.first).not_to be_finalized
    post "#{path}/heartbeat", params: claim, headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("execution_finished" => true)
    2.times do
      post "#{path}/usage", params: claim.merge(usage: [], incomplete: false), headers: headers, as: :json
      expect(response).to have_http_status(:ok)
    end
    expect(turn.ai_task.ai_usage_attempts.first.reload).to be_finalized
    expect(turn.reload).to be_accepted
    expect(interview.reload.revision).to eq(1)
  end

  it "rejects malformed history and negative or unknown-execution charges" do
    post "#{path}/claim", headers: headers, as: :json
    claim = response.parsed_body.slice("attempt_id", "claim_generation")
    post "#{path}/accept", params: claim.merge(transcript: "Answer", decision: "advance", history_version: 1, model_history: "bad"), headers: headers, as: :json
    expect(response).to have_http_status(:conflict)
    post "#{path}/usage", params: { attempt_id: turn.reload.attempt_id, usage: [ { cost_microdollars: -1 } ] }, headers: headers, as: :json
    expect(response).to have_http_status(:conflict)
    expect(turn.ai_task.cost_microdollars).to eq(0)
  end

  it "rolls back partial dialogue when a speech write fails inside the callback transaction" do
    post "#{path}/claim", headers: headers, as: :json
    claim = response.parsed_body.slice("attempt_id", "claim_generation")
    allow_any_instance_of(InterviewSessionOperation).to receive(:save!).and_wrap_original do |save, *args|
      record = save.receiver
      if record.speech?
        record.errors.add(:base, "injected speech write failure")
        raise ActiveRecord::RecordInvalid, record
      end
      save.call(*args)
    end
    post "#{path}/accept", params: claim.merge(transcript: "Answer", decision: "advance", history_version: 1, model_history: []), headers: headers, as: :json
    expect(response).to have_http_status(:conflict)
    expect(interview.reload).to have_attributes(revision: 0, status: "active")
    expect(interview.messages.pluck(:kind)).to eq([ "opening" ])
    expect(turn.reload.ai_task).to be_queued
  end

  it "does not treat a signed-in browser session as internal authentication" do
    sign_in interview.user
    post "#{path}/claim", as: :json
    expect(response).to have_http_status(:unauthorized)
  end
end

RSpec.describe "Internal credential scheme", type: :request do
  it "rejects the raw secret without the Bearer scheme" do
    original = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "scheme-secret"
    get "/internal/interviews/operations", headers: { "Authorization" => "scheme-secret" }
    expect(response).to have_http_status(:unauthorized)
  ensure
    ENV["INTERVIEW_SERVICE_SECRET"] = original
  end
end

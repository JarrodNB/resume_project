# Saved execution configuration keeps scripted sessions isolated from paid runtimes.
require "rails_helper"

RSpec.describe "Interview execution modes", type: :service do
  # These scenarios exercise the retained provider-speech path explicitly.
  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_SPEECH_PLAYBACK").and_return("provider")
  end

  let(:user) { create(:user) }
  let(:fake) { Interviews::CreateFixtureService.call(user: user).value }
  let(:real) { Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value }

  it "defaults existing creation paths to a frozen fake configuration" do
    expect(fake.execution_mode).to eq("fake")
    expect(fake.execution_config).to eq(Interviews::ExecutionConfiguration::FAKE)
    expect { fake.update!(execution_mode: "real") }.to raise_error(ActiveRecord::ReadonlyAttributeError)
    expect { fake.update!(execution_config: {}) }.to raise_error(ActiveRecord::ReadonlyAttributeError)
  end

  it "saves approved real models and rejects unknown configuration" do
    expect(real.execution_config).to include("transcription_model" => "gpt-transcribe", "interviewer_model" => "gpt-6-luna", "speech_model" => "gpt-4o-mini-tts", "voice" => "marin")
    expect(Interviews::CreateFixtureService.call(user: user, execution_mode: "other")).not_to be_success
    invalid = user.interview_sessions.new(execution_mode: "real", execution_config: {}, expires_at: 1.day.from_now)
    expect(invalid).not_to be_valid
    expect { invalid.save!(validate: false) }.to raise_error(ActiveRecord::StatementInvalid)
  end

  it "keeps turn retries and speech recovery in the saved mode" do
    turn = Interviews::SubmitTurnService.call(interview: real, question_id: real.questions.first.id,
      recording_id: ready_interview_recording(real).id, expected_revision: 0, submission_key: "answer").value
    expect(Interviews::ClaimOperationService.call(operation: turn)).not_to be_success
    claim = Interviews::ClaimOperationService.call(operation: turn, execution_mode: "real")
    expect(claim).to be_success
    expect(claim.value[:execution_config]).to eq(real.execution_config)
    Interviews::FailOperationService.call(operation: turn, attempt_id: turn.attempt_id,
      claim_generation: turn.claim_generation, code: "dependency_unavailable", retryable: true)
    travel 3.seconds
    expect(Interviews::DiscoverOperationsService.call.value).not_to include(turn.id)
    expect(Interviews::DiscoverOperationsService.call(execution_mode: "real").value).to include(turn.id)
    expect(Interviews::ClaimOperationService.call(operation: turn)).not_to be_success
    expect(turn.reload.execution_count).to eq(1)
    expect(Interviews::ClaimOperationService.call(operation: turn, execution_mode: "real")).to be_success
    speech = real.operations.speech.first
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).to be_success
    travel 31.seconds
    expect(Interviews::ClaimOperationService.call(operation: speech)).not_to be_success
    expect(speech.reload.status).to eq("running")
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real").errors).to include("Recovery scheduled")
    travel 3.seconds
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).to be_success
  end

  it "filters discovery and fences claims before any recovery or accounting mutation" do
    fake_operation = fake.operations.first
    real_operation = real.operations.first
    expect(Interviews::DiscoverOperationsService.call.value).to include(fake_operation.id)
    expect(Interviews::DiscoverOperationsService.call.value).not_to include(real_operation.id)
    expect(Interviews::DiscoverOperationsService.call(execution_mode: "real").value).to eq([ real_operation.id ])
    expect(Interviews::ClaimOperationService.call(operation: real_operation)).not_to be_success
    expect(real_operation.reload.execution_count).to eq(0)
    expect(Interviews::ClaimOperationService.call(operation: real_operation, execution_mode: "real").value[:execution_config]).to eq(real.execution_config)
    travel 31.seconds
    expect(Interviews::ClaimOperationService.call(operation: real_operation)).not_to be_success
    expect(real_operation.reload).to have_attributes(status: "running", execution_count: 1)
    expect(Interviews::DiscoverOperationsService.call(execution_mode: "unknown")).not_to be_success
    expect(Interviews::ClaimOperationService.call(operation: fake_operation, execution_mode: "real")).not_to be_success
    expect(fake_operation.reload.execution_count).to eq(0)
  end
end

# Recorded review is private capture work and never advances the interview.
require "rails_helper"

RSpec.describe "Recorded transcript review" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:recording) { ready_interview_recording(interview) }
  let(:input) { { interview: interview, question_id: interview.questions.first.id, expected_revision: 0, recording_id: recording.id } }

  it "deduplicates capture, transcribes under a claim, and leaves progression unchanged" do
    operation = Interviews::StartRecordedTranscriptionService.call(**input).value
    expect(Interviews::StartRecordedTranscriptionService.call(**input).value.id).to eq(operation.id)
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    expect(claim[:kind]).to eq("transcription")
    expect(claim[:payload]).to eq({ recording_id: recording.id })
    args = { operation: operation, attempt_id: claim[:attempt_id], claim_generation: claim[:claim_generation], transcript: "I maintained the service." }
    expect(Interviews::AcceptTranscriptionService.call(**args)).to be_success
    expect(Interviews::AcceptTranscriptionService.call(**args)).to be_success
    expect(operation.reload.accepted_result).to eq({ "transcript" => "I maintained the service." })
    expect(interview.reload.revision).to eq(0)
    expect(interview.questions.first.accepted_answer_count).to eq(0)
    expect(interview.messages.where(kind: "answer")).to be_empty
    expect(interview.operations.turn).to be_empty
  end

  it "submits edited text exactly once after review and scrubs captures on abandon" do
    operation = Interviews::StartRecordedTranscriptionService.call(**input).value
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    Interviews::AcceptTranscriptionService.call(operation: operation, attempt_id: claim[:attempt_id], claim_generation: claim[:claim_generation], transcript: "Unedited transcript")
    text = "I repaired the scheduler with a teammate."
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: input[:question_id], expected_revision: 0,
      submission_key: "reviewed", candidate_transcript: text, transcription_mode: "typed").value
    claim = Interviews::ClaimOperationService.call(operation: turn).value
    args = { operation: turn, attempt_id: claim[:attempt_id], claim_generation: claim[:claim_generation], transcript: text,
      decision: "continue", reply: "What changed?", history_version: 1,
      model_history: [ { "kind" => "request", "parts" => [ { "part_kind" => "user-prompt", "content" => text } ] } ] }
    2.times { expect(Interviews::AcceptTurnService.call(**args)).to be_success }
    expect(interview.reload.revision).to eq(1)
    expect(interview.questions.first.accepted_answer_count).to eq(1)
    expect(interview.messages.answer.pluck(:content)).to eq([ text ])
    expect(Interviews::AbandonService.call(interview: interview)).to be_success
    expect(operation.reload.accepted_result).to eq({})
  end

  it "rejects foreign media, stale captures and late completion after cancellation" do
    foreign = Interviews::CreateFixtureService.call(user: create(:user)).value
    expect(Interviews::StartRecordedTranscriptionService.call(**input.merge(recording_id: ready_interview_recording(foreign).id))).not_to be_success
    expect(Interviews::StartRecordedTranscriptionService.call(**input.merge(expected_revision: 1))).not_to be_success
    operation = Interviews::StartRecordedTranscriptionService.call(**input).value
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    expect(Interviews::CancelRecordedTranscriptionService.call(operation: operation)).to be_success
    expect(Interviews::AcceptTranscriptionService.call(operation: operation, attempt_id: claim[:attempt_id], claim_generation: claim[:claim_generation], transcript: "late")).not_to be_success
    expect(operation.reload.accepted_result).to eq({})
  end
  it "discovers durable work, fences stale revisions and expires its private text" do
    operation = Interviews::StartRecordedTranscriptionService.call(**input).value
    expect(Interviews::DiscoverOperationsService.call.value).to include(operation.id)
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    args = { operation: operation, attempt_id: claim[:attempt_id], claim_generation: claim[:claim_generation], transcript: "review me" }
    interview.update!(revision: 1)
    expect(Interviews::AcceptTranscriptionService.call(**args)).not_to be_success
    interview.update!(revision: 0)
    expect(Interviews::AcceptTranscriptionService.call(**args)).to be_success
    recording.update!(expires_at: 1.second.ago)
    Interviews::CleanupService.call(storage: instance_double(Interviews::MediaStorage, delete: true))
    expect(operation.reload.accepted_result).to eq({})
  end

  it "uses bounded retries and charges delayed provider usage after cancellation once" do
    operation = Interviews::StartRecordedTranscriptionService.call(**input).value
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    identity = { operation: operation, attempt_id: claim[:attempt_id], claim_generation: claim[:claim_generation] }
    observation = SecureRandom.uuid
    expect(Interviews::StartProviderAttemptService.call(**identity, observation_id: observation,
      stage: "transcription", provider: "fake", model: "fake-transcription-v1")).to be_success
    expect(Interviews::CancelRecordedTranscriptionService.call(operation: operation)).to be_success
    2.times do
      expect(Interviews::RecordUsageService.call(operation: operation, attempt_id: claim[:attempt_id],
        observation_id: observation, usage: [ { "cost_microdollars" => 0 } ], incomplete: false)).to be_success
    end
    expect(operation.ai_task.ai_usage_attempts.where(attempt_id: observation).count).to eq(1)
    expect(Interviews::RetryOperationService.call(operation: operation)).not_to be_success
  end
  it "bounds retry cycles and capture counts without consuming an answer" do
    operation = Interviews::StartRecordedTranscriptionService.call(**input).value
    3.times do
      claim = Interviews::ClaimOperationService.call(operation: operation.reload).value
      expect(Interviews::FailOperationService.call(operation: operation, attempt_id: claim[:attempt_id], claim_generation: claim[:claim_generation],
        code: "dependency_unavailable", retryable: true)).to be_success
      travel 11.seconds
    end
    expect(operation.reload).to have_attributes(status: "failed", execution_count: 3)
    expect(Interviews::RetryOperationService.call(operation: operation)).to be_success
    expect(operation.reload.cycle_execution_count).to eq(0)
    Interviews::CancelRecordedTranscriptionService.call(operation: operation)
    5.times do
      extra = ready_interview_recording(interview)
      capture = Interviews::StartRecordedTranscriptionService.call(**input.merge(recording_id: extra.id)).value
      Interviews::CancelRecordedTranscriptionService.call(operation: capture)
    end
    expect(Interviews::StartRecordedTranscriptionService.call(**input.merge(recording_id: ready_interview_recording(interview).id))).not_to be_success
    expect(interview.reload.revision).to eq(0)
    expect(interview.operations.turn).to be_empty
  end
end

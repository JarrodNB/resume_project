# Exercises durable execution leases and accounting without providers or HTTP.
require "rails_helper"

RSpec.describe Interviews::ClaimOperationService do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:operation) { interview.operations.first }

  it "persists a unique attempt and unknown-cost ledger marker before returning work" do
    result = described_class.call(operation: operation)
    expect(result).to be_success
    expect(operation.reload).to have_attributes(status: "running", claim_generation: 1)
    expect(result.value.fetch(:payload)).to include(interview_id: interview.id, user_id: interview.user_id)
    expect(operation.ai_task.ai_usage_attempts.first).to have_attributes(attempt_id: operation.attempt_id, finalized: false, incomplete: true)
    expect(described_class.call(operation: operation)).not_to be_success
  end
end

RSpec.describe "Interview execution recovery" do
  before { freeze_time }
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:operation) { interview.operations.first }
  def claim
    Interviews::ClaimOperationService.call(operation: operation)
  end
  def identity
    { operation: operation, attempt_id: operation.attempt_id, claim_generation: operation.claim_generation }
  end

  it "bounds checkpoints and heartbeat at the absolute deadline and rejects expired identities" do
    claim
    deadline = operation.execution_deadline
    travel_to(deadline - 5.seconds) do
      # Keep lease alive to exercise the absolute cap.
      operation.update!(lease_expires_at: deadline)
      result = Interviews::RenewClaimService.call(**identity, checkpoint: "transcribed")
      expect(result).to be_success
      expect(operation.reload.lease_expires_at).to eq(deadline)
      expect(Interviews::RenewClaimService.call(**identity, checkpoint: "raw sensitive text")).not_to be_success
    end
    travel_to(deadline + 1.second) { expect(Interviews::RenewClaimService.call(**identity)).not_to be_success }
  end

  [ true, false ].each do |retryable|
    it "acknowledges finished failure accounting with retryable=#{retryable} without reviving the claim" do
      expect(claim).to be_success
      original = identity
      expect(Interviews::FailOperationService.call(**original, code: "dependency_unavailable", retryable: retryable)).to be_success
      saved = operation.reload.attributes
      result = Interviews::RenewClaimService.call(**original)
      expect(result).to be_success
      expect(result.value).to eq({ execution_finished: true })
      expect(operation.reload.attributes).to eq(saved)
      expect(Interviews::RenewClaimService.call(**original.merge(claim_generation: 0))).not_to be_success
      expect(Interviews::StartProviderAttemptService.call(**original, observation_id: SecureRandom.uuid,
        stage: "speech", provider: "fake", model: "scripted-v1")).not_to be_success
      interview.update!(status: "abandoned")
      expect(Interviews::RenewClaimService.call(**original)).not_to be_success
    end
  end

  it "replaces expired claims after backoff and retains late usage without duplicate charges" do
    claim
    old = identity
    observation_id = SecureRandom.uuid
    expect(Interviews::StartProviderAttemptService.call(**old, observation_id: observation_id, stage: "speech", provider: "fake", model: "scripted-v1")).to be_success
    travel 31.seconds
    expect(claim).not_to be_success
    expect(operation.reload).to have_attributes(status: "pending", failure_code: "lease_expired")
    expect(Interviews::RenewClaimService.call(**old)).not_to be_success
    expect(claim).not_to be_success
    travel 2.seconds
    expect(claim).to be_success
    expect(operation.reload.claim_generation).to eq(2)
    expect(Interviews::RenewClaimService.call(**old)).not_to be_success
    report = { operation: operation, attempt_id: old[:attempt_id], observation_id: observation_id, usage: [ { "cost_microdollars" => 123 } ] }
    2.times { expect(Interviews::RecordUsageService.call(**report)).to be_success }
    expect(operation.ai_task.reload.cost_microdollars).to eq(123)
    expect(operation.ai_task.ai_usage_attempts.where(finalized: false).count).to eq(2)
    expect(Interviews::RecordUsageService.call(**report.merge(attempt_id: SecureRandom.uuid))).not_to be_success
  end

  it "stops automatic execution after three attempts and explicit retries after six" do
    2.times do |cycle|
      3.times do |index|
        expect(claim).to be_success
        expect(Interviews::FailOperationService.call(**identity, code: "dependency_unavailable", retryable: true)).to be_success
        if index < 2
          expect(operation.reload.retry_at).to eq(Time.current + [ 2, 5 ][index].seconds)
          expect(operation.ai_task.ai_task_outcomes.count).to eq(cycle)
          travel [ 2, 5 ][index].seconds
        end
      end
      expect(operation.reload).to be_failed
      expect(operation.ai_task.ai_task_outcomes.order(:sequence).pluck(:status)).to eq([ "failed" ] * (cycle + 1))
      retry_result = Interviews::RetryOperationService.call(operation: operation)
      expect(retry_result.success?).to eq(cycle.zero?)
    end
    expect(operation.execution_count).to eq(6)
    expect(interview.questions.first.accepted_answer_count).to eq(0)
  end

  it "rejects recording retries after the one-hour retention bound" do
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
      recording_id: ready_interview_recording(interview).id, expected_revision: 0, submission_key: "answer").value
    travel 1.hour + 1.second
    expect(Interviews::ClaimOperationService.call(operation: turn)).not_to be_success
  end

  it "admits logical work through existing limits without publishing queues" do
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 0)
    expect(Shoryuken::Client).not_to receive(:queues)
    expect(claim).not_to be_success
    expect(operation.reload.ai_task).to be_nil
    expect(operation).to have_attributes(status: "failed", failure_code: "ai_usage_limit_reached", execution_count: 0,
      retry_at: nil, retry_expires_at: interview.expires_at)
    expect(operation.execution_attempts.count).to eq(0)
    expect(interview.questions.first.reload.accepted_answer_count).to eq(0)
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    expect(claim).not_to be_success
    expect(Interviews::RetryOperationService.call(operation: operation)).to be_success
    expect(claim).to be_success
  end
end

RSpec.describe "Interview admission", type: :service do
  it "preserves the recording lifetime when admission fails before any execution" do
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    recording = ready_interview_recording(interview)
    operation = Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
      recording_id: recording.id, expected_revision: 0, submission_key: "denied").value
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 0)

    result = Interviews::ClaimOperationService.call(operation: operation)

    expect(result.errors.join).to include("interview operations running")
    expect(operation.reload).to have_attributes(status: "failed", failure_code: "ai_usage_limit_reached", execution_count: 0,
      retry_expires_at: recording.expires_at)
    expect(operation.execution_attempts.count).to eq(0)
    expect(interview.questions.first.reload.accepted_answer_count).to eq(0)
    expect(recording.reload.expires_at).to be > Time.current
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    expect(Interviews::RetryOperationService.call(operation: operation)).to be_success
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
  end

  it "does not execute a stale turn or expired completed-session speech" do
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
      recording_id: ready_interview_recording(interview).id, expected_revision: 0, submission_key: "stale").value
    interview.update!(revision: 1)
    expect(Interviews::ClaimOperationService.call(operation: turn)).not_to be_success
    interview.update!(status: "completed", completed_at: 2.hours.ago)
    expect(Interviews::ClaimOperationService.call(operation: interview.operations.speech.first)).not_to be_success
    expect(interview.user.ai_tasks.count).to eq(0)
  end

  it "rechecks budgets before an automatic retry without counting its own in-flight task" do
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    operation = interview.operations.first
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    Interviews::FailOperationService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, code: "execution_failed", retryable: true)
    travel 3.seconds
    operation.ai_task.update!(cost_microdollars: 1)
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 1)
    expect(Interviews::ClaimOperationService.call(operation: operation)).not_to be_success
    expect(operation.reload.execution_count).to eq(1)
    expect(operation).to have_attributes(status: "failed", failure_code: "ai_usage_limit_reached", retry_at: nil)
    expect(operation.ai_task.reload).to have_attributes(status: "failed", error_message: "ai_usage_limit_reached")
    expect(operation.execution_attempts.count).to eq(1)
    expect(Interviews::RetryOperationService.call(operation: operation)).not_to be_success
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 2)
    expect(Interviews::ClaimOperationService.call(operation: operation)).not_to be_success
    expect(Interviews::RetryOperationService.call(operation: operation)).to be_success
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
  end
end

RSpec.describe "Invalid interview input recovery", type: :service do
  %w[transcript_too_long empty_audio audio_too_large audio_too_long invalid_recording context_limit].each do |failure_code|
    it "records #{failure_code} as terminal and expires its recording without accepting an answer" do
      interview = Interviews::CreateFixtureService.call(user: create(:user)).value
      recording = ready_interview_recording(interview)
      operation = Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
        recording_id: recording.id, expected_revision: 0, submission_key: "oversized").value
      expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success

      result = Interviews::FailOperationService.call(operation: operation, attempt_id: operation.attempt_id,
        claim_generation: operation.claim_generation, code: failure_code, retryable: true)

      expect(result).to be_success
      expect(operation.reload).to have_attributes(status: "failed", failure_code: failure_code, retry_at: nil)
      expect(recording.reload.expires_at).to be <= Time.current
      expect(operation.ai_task.reload).to have_attributes(status: "failed", error_message: failure_code)
      expect(interview.questions.first.reload.accepted_answer_count).to eq(0)
      expect(Interviews::RetryOperationService.call(operation: operation)).not_to be_success
    end
  end
end

RSpec.describe "Interview storage recovery", type: :service do
  it "preserves a recording and schedules bounded recovery when storage is unavailable" do
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    recording = ready_interview_recording(interview)
    operation = Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
      recording_id: recording.id, expected_revision: 0, submission_key: "storage").value
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    result = Interviews::FailOperationService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, code: "storage_unavailable", retryable: true)
    expect(result).to be_success
    expect(operation.reload).to have_attributes(status: "pending", failure_code: "storage_unavailable")
    expect(operation.retry_at).to be > Time.current
    expect(recording.reload.expires_at).to be > Time.current
    expect(interview.questions.first.reload.accepted_answer_count).to eq(0)
  end
end

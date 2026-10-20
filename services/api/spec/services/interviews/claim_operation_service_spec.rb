# Exercises durable execution leases and accounting without providers or HTTP.
require "rails_helper"

RSpec.describe Interviews::ClaimOperationService do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:operation) { interview.operations.first }

  it "persists a unique attempt and unknown-cost ledger marker before returning work" do
    result = described_class.call(operation: operation)
    expect(result).to be_success
    expect(operation.reload).to have_attributes(status: "running", claim_generation: 1)
    expect(result.value.fetch(:payload).fetch(:text)).to eq(interview.messages.first.content)
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

  it "replaces expired claims after backoff and retains late usage without duplicate charges" do
    claim
    old = identity
    observation_id = SecureRandom.uuid
    expect(Interviews::StartProviderAttemptService.call(**old, observation_id: observation_id, stage: "speech", provider: "fake", model: "scripted-v1")).to be_success
    travel 31.seconds
    expect(claim).not_to be_success
    expect(operation.reload).to have_attributes(status: "pending", failure_code: "lease_expired")
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
          travel [ 2, 5 ][index].seconds
        end
      end
      expect(operation.reload).to be_failed
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
    interview.user.update!(max_in_flight_ai_tasks: 0)
    expect(Shoryuken::Client).not_to receive(:queues)
    expect(claim).not_to be_success
    expect(operation.reload.ai_task).to be_nil
  end
end

RSpec.describe "Interview admission", type: :service do
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
    interview.user.update!(max_in_flight_ai_tasks: 1)
    operation = interview.operations.first
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    Interviews::FailOperationService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, code: "execution_failed", retryable: true)
    travel 3.seconds
    operation.ai_task.update!(cost_microdollars: 1)
    interview.user.update!(monthly_ai_budget_microdollars: 1)
    expect(Interviews::ClaimOperationService.call(operation: operation)).not_to be_success
    expect(operation.reload.execution_count).to eq(1)
    interview.user.update!(monthly_ai_budget_microdollars: 2)
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
  end
end

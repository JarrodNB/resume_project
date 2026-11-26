# Runs the same claimed-operation lifecycle checks against both adapters (chat and interviews).
# Feature-specific rules (expiry, checkpoints, revisions) stay in each feature's own specs.
require "rails_helper"

RSpec.shared_examples "a leased AI operation" do
  before do
    freeze_time
    allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: :accepted, errors: []))
  end

  let(:lifecycle_bounds) { AiExecutions::OperationLifecycle }

  def identity
    { attempt_id: operation.attempt_id, claim_generation: operation.claim_generation }
  end

  def renew(**overrides) = AiExecutions::RenewClaimService.call(operation: operation, **identity.merge(overrides))

  def fail_with(code: "execution_failed", retryable: false, **overrides)
    AiExecutions::FailOperationService.call(operation: operation, **identity.merge(overrides), code: code, retryable: retryable)
  end

  def recover(job_id: operation.recovery_job_id, generation: operation.claim_generation, attempt_id: operation.attempt_id)
    at = [ operation.lease_expires_at, operation.execution_deadline ].min
    AiExecutions::RecoverOperationService.call(operation: operation, attempt_id: attempt_id, generation: generation,
      expected_at: at.iso8601(6), job_id: job_id)
  end

  describe "claiming" do
    it "reserves one fenced attempt with a lease, deadline and recovery job" do
      expect(claim_operation).to be_success
      expect(operation.reload).to have_attributes(status: "running", claim_generation: 1, execution_count: 1, cycle_execution_count: 1)
      expect(operation.attempt_id).to be_present
      expect(operation.lease_expires_at).to eq(lifecycle_bounds::LEASE.from_now)
      expect(operation.execution_deadline).to eq(lifecycle_bounds::DEADLINE.from_now)
      expect(operation.recovery_job_id).to be_present
      expect(operation.execution_attempts.pluck(:attempt_id, :claim_generation)).to eq([ [ operation.attempt_id, 1 ] ])
    end

    it "refuses a second claim while the lease is live" do
      claim_operation
      result = claim_operation
      expect(result).not_to be_success
      expect(result.errors).to eq([ "Operation already claimed" ])
    end

    it "turns an expired lease into a scheduled retry instead of a new claim" do
      claim_operation
      travel_to(operation.lease_expires_at + 1.second) do
        result = claim_operation
        expect(result.errors).to eq([ "Recovery scheduled" ])
        expect(operation.reload).to have_attributes(status: "pending", failure_code: stale_claim_code)
        expect(operation.retry_at).to be > Time.current
      end
    end

    it "stops claiming once the execution budget is spent" do
      claim_operation
      fail_with(retryable: true)
      operation.update!(retry_at: nil, execution_count: lifecycle_bounds::MAX_EXECUTIONS)
      expect(claim_operation).not_to be_success
      expect(operation.reload.status).to eq(claim_budget_status)
    end
  end

  describe "renewing" do
    before { claim_operation }

    it "extends the lease for the exact attempt without passing the deadline" do
      travel_to(operation.lease_expires_at - 5.seconds) do
        result = renew
        expect(result).to be_success
        expect(result.value.fetch(:lease_expires_at)).to eq([ lifecycle_bounds::LEASE.from_now, operation.execution_deadline ].min)
        expect(operation.reload.lease_expires_at).to eq(result.value.fetch(:lease_expires_at))
      end
    end

    it "rejects a stale generation, a different attempt and an expired lease" do
      expect(renew(claim_generation: 0)).not_to be_success
      expect(renew(attempt_id: SecureRandom.uuid)).not_to be_success
      travel_to(operation.lease_expires_at + 1.second) { expect(renew).not_to be_success }
    end

    it "gives a read-only receipt for a finished execution, and only to the same attempt" do
      expect(fail_with).to be_success
      expect(renew.value).to eq(execution_finished: true)
      expect(renew(claim_generation: 0)).not_to be_success
      expect(renew(attempt_id: SecureRandom.uuid)).not_to be_success
    end

    it "stops giving that receipt once the lease has expired" do
      fail_with
      travel_to(operation.lease_expires_at + 1.second) { expect(renew).not_to be_success }
    end
  end

  describe "failing" do
    before { claim_operation }

    it "ends the operation for a final failure and its task with the safe code" do
      result = fail_with(code: "execution_failed", retryable: false)
      expect(result).to be_success
      expect(operation.reload).to have_attributes(status: "failed", failure_code: "execution_failed", retry_at: nil)
      expect(operation.ai_task).to be_failed
    end

    it "schedules a bounded retry for a retryable failure" do
      expect(fail_with(retryable: true)).to be_success
      expect(operation.reload).to have_attributes(status: "pending", failure_code: "execution_failed")
      expect(operation.retry_at).to eq(Time.current + lifecycle_bounds::BACKOFF.first.seconds)
      expect(operation.ai_task).to be_queued
      expect(operation.delivery_job_id).to be_present
    end

    it "never retries a code the feature marks as final" do
      fail_with(code: final_failure_code, retryable: true)
      expect(operation.reload.status).to eq("failed")
    end

    it "stops retrying when the cycle or total budget is used up" do
      operation.update!(cycle_execution_count: lifecycle_bounds::MAX_CYCLE_EXECUTIONS)
      fail_with(retryable: true)
      expect(operation.reload.status).to eq("failed")
      operation.update!(status: "running", cycle_execution_count: 1, execution_count: lifecycle_bounds::MAX_EXECUTIONS, lease_expires_at: 30.seconds.from_now)
      fail_with(retryable: true)
      expect(operation.reload.status).to eq("failed")
    end

    it "rejects unknown codes, non-boolean flags and stale identities without changing anything" do
      expect(fail_with(code: "raw provider text")).not_to be_success
      expect(fail_with(retryable: "yes")).not_to be_success
      expect(fail_with(claim_generation: 0)).not_to be_success
      expect(fail_with(attempt_id: SecureRandom.uuid)).not_to be_success
      expect(operation.reload.status).to eq("running")
    end
  end

  describe "recovering" do
    before { claim_operation }

    it "does nothing for a stale job, an older generation or a lease that is still live" do
      job_id = operation.recovery_job_id
      expect(recover(job_id: "other-job")).to be_success
      expect(recover(generation: 0)).to be_success
      expect(operation.reload.status).to eq("running")
      expect(recover(job_id: job_id)).to be_success
      expect(operation.reload).to have_attributes(status: "running")
      expect(operation.recovery_job_id).not_to eq(job_id)
    end

    it "fails the expired attempt and schedules another" do
      job_id = operation.recovery_job_id
      travel_to(operation.lease_expires_at + 1.second) do
        expect(recover(job_id: job_id)).to be_success
        expect(operation.reload).to have_attributes(status: "pending", failure_code: "lease_expired")
      end
    end

    it "reports a passed deadline as a timeout" do
      job_id = operation.recovery_job_id
      operation.update!(lease_expires_at: operation.execution_deadline)
      travel_to(operation.execution_deadline + 1.second) do
        expect(recover(job_id: job_id)).to be_success
        expect(operation.reload.failure_code).to eq("execution_timeout")
      end
    end
  end
end

RSpec.describe "Chat operations through the shared lifecycle" do
  let(:conversation) { create(:user).chat_conversations.create! }
  let!(:operation) { Chat::StartMessageService.call(conversation: conversation, message: "Career question", idempotency_key: SecureRandom.uuid).value }

  def claim_operation = Chat::ClaimOperationService.call(operation: operation)
  let(:final_failure_code) { "screening_blocked" }
  let(:stale_claim_code) { "lease_expired" }
  let(:claim_budget_status) { "failed" } # chat ends the operation with execution_timeout

  it_behaves_like "a leased AI operation"
end

RSpec.describe "Interview operations through the shared lifecycle" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let!(:operation) { interview.operations.first }

  def claim_operation = Interviews::ClaimOperationService.call(operation: operation)
  let(:final_failure_code) { "context_limit" }
  let(:stale_claim_code) { "lease_expired" }
  let(:claim_budget_status) { "pending" } # interviews leave the operation for an explicit retry

  it_behaves_like "a leased AI operation"
end

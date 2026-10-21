# Local spoken-interview testing keeps accounting without turning unknown costs into a stop.
# Normal admission, non-development environments and resource safeguards stay independent.
require "rails_helper"

RSpec.describe "Unmetered local interview testing" do
  let(:user) { create(:user, summary: "Maintain laboratory instruments") }

  def local_testing(development: true, enabled: "true")
    allow(Rails.env).to receive(:development?).and_return(development)
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_LOCAL_TESTING_UNMETERED").and_return(enabled)
  end

  def claimed_operation
    interview = Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value
    operation = interview.operations.first
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
    operation
  end

  def start(operation, id = SecureRandom.uuid, **labels)
    Interviews::StartProviderAttemptService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, observation_id: id, stage: "speech",
      provider: "openai", model: "gpt-4o-mini-tts", **labels)
  end

  it "continues after unknown or over-target estimates while preserving and reconciling every record" do
    local_testing
    operation = claimed_operation
    old = InterviewVerificationReservation.create!(observation_id: SecureRandom.uuid, reserved_microdollars: 6_000_000)
    id = SecureRandom.uuid

    expect(start(operation, id)).to be_success
    expect(old.reload.actual_microdollars).to be_nil
    reservation = InterviewVerificationReservation.find_by!(observation_id: id)
    expect(reservation.reserved_microdollars).to eq(250_000)
    expect(operation.execution_attempts.first.provider_attempts.find_by!(observation_id: id).stage).to eq("speech")
    expect(Interviews::RecordUsageService.call(operation: operation, attempt_id: operation.attempt_id,
      observation_id: id, usage: [ { "cost_microdollars" => 1_221 } ])).to be_success
    expect(reservation.reload.actual_microdollars).to eq(1_221)
    expect(operation.ai_task.reload.cost_microdollars).to eq(1_221)
    expect(start(operation)).to be_success
  end

  it "ignores interview spending and session-start limits but retains concurrency and general AI limits" do
    local_testing
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 0)
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 0)
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    user.update!(monthly_ai_budget_microdollars: 0)

    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user, interview: true)).to be_success
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).not_to be_success
    create(:ai_task, user: user, task_type: "interview_speech", status: "queued")
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user, interview: true).errors.join).to include("operations running")
  end

  [ [ false, "true" ], [ true, nil ], [ true, "false" ] ].each do |development, enabled|
    it "preserves normal gates with development=#{development} and explicit mode=#{enabled.inspect}" do
      local_testing(development: development, enabled: enabled)
      operation = claimed_operation
      InterviewVerificationReservation.create!(observation_id: SecureRandom.uuid, reserved_microdollars: 6_000_000)
      expect(Interviews::VerificationBudget.enforced?).to be(true)
      expect(start(operation)).not_to be_success
      expect(operation.execution_attempts.first.provider_attempts).to be_empty
      stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 0)
      expect(AiUsage::CheckAiTaskAllowanceService.call(user: user, interview: true)).not_to be_success
    end
  end

  it "still rejects an unsupported provider identity in local testing" do
    local_testing
    operation = claimed_operation
    expect(start(operation, provider: "fake", model: "scripted")).not_to be_success
    expect(InterviewVerificationReservation.count).to eq(0)
    expect(operation.execution_attempts.first.provider_attempts).to be_empty
  end
end

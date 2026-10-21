# Exercises deliberate abandonment through lifecycle services, keeping accounting durable.
require "rails_helper"

RSpec.describe "Interview abandonment" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }

  it "fences work once, invalidates audio immediately and retains unknown usage for late reconciliation" do
    operation = interview.operations.first
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    observation_id = SecureRandom.uuid
    expect(Interviews::StartProviderAttemptService.call(operation: operation, **claim.slice(:attempt_id, :claim_generation),
      observation_id: observation_id, stage: "speech", provider: "fake", model: "fake")).to be_success
    media = ready_interview_recording(interview)
    revision = interview.revision

    expect(Interviews::AbandonService.call(interview: interview)).to be_success
    expect(interview.reload).to have_attributes(status: "abandoned", revision: revision + 1)
    expect(media.reload).to have_attributes(status: "delete_pending")
    expect(media.expires_at).to be <= Time.current
    expect(operation.reload).to have_attributes(status: "expired", retry_at: nil)
    expect(operation.ai_task.ai_usage_attempts.find_by!(attempt_id: observation_id)).to be_incomplete
    expect(Interviews::AbandonService.call(interview: interview)).to be_success
    expect(interview.reload.revision).to eq(revision + 1)
    expect(Interviews::RenewClaimService.call(operation: operation, **claim.slice(:attempt_id, :claim_generation))).not_to be_success
    expect(Interviews::ClaimOperationService.call(operation: operation)).not_to be_success
    expect(Interviews::StartProviderAttemptService.call(operation: operation, **claim.slice(:attempt_id, :claim_generation),
      observation_id: observation_id, stage: "speech", provider: "fake", model: "fake")).not_to be_success
    expect(Interviews::RecordUsageService.call(operation: operation, attempt_id: claim[:attempt_id], observation_id: observation_id,
      usage: [ { "cost_microdollars" => 123 } ])).to be_success
    expect(operation.ai_task.reload.cost_microdollars).to eq(123)
  end

  it "rejects completion and retains abandoned identity when eventual expiry scrubs content" do
    interview.update!(status: "completed", completed_at: Time.current)
    expect(Interviews::AbandonService.call(interview: interview)).not_to be_success
    interview.update!(status: "active", completed_at: nil)
    expect(Interviews::AbandonService.call(interview: interview)).to be_success
    interview.update!(expires_at: 1.second.ago)
    expect(Interviews::CleanupService.call.value[:purged_sessions]).to eq(1)
    expect(interview.reload).to have_attributes(status: "abandoned", frozen_context: {}, prepared_role: {})
    expect(interview.messages.pluck(:content)).to all(eq("[expired]"))
  end

  it "fences preparation acceptance, heartbeat and failure callbacks without exposing a partial role" do
    owner = create(:user, summary: "I maintain laboratory instruments")
    preparing = Interviews::StartPreparationService.call(user: owner).value
    operation = preparing.operations.first
    identity = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value.slice(:attempt_id, :claim_generation)
    expect(Interviews::AbandonService.call(interview: preparing)).to be_success
    role = { "title" => "Fictional technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Calibration" ] }
    questions = 9.times.map { |i| { "question_type" => %w[behavioral technical knowledge][i % 3], "content" => "Question #{i}?" } }
    expect(Interviews::AcceptPreparationService.call(operation: operation, **identity, role: role, questions: questions)).not_to be_success
    expect(Interviews::RenewClaimService.call(operation: operation, **identity)).not_to be_success
    expect(Interviews::FailOperationService.call(operation: operation, **identity, code: "dependency_unavailable", retryable: true)).not_to be_success
    expect(Interviews::RetryOperationService.call(operation: operation)).not_to be_success
    expect(Interviews::DiscoverOperationsService.call(execution_mode: "real").value).not_to include(operation.id)
    expect(preparing.reload.prepared_role).to eq({})
    expect(preparing.questions).to be_empty
    expect(Interviews::BeginService.call(interview: preparing)).not_to be_success
    expect(Interviews::RecordUsageService.call(operation: operation, attempt_id: identity[:attempt_id], usage: [])).to be_success
  end

  it "abandons reviewed ready sessions without creating any opening or speech" do
    interview.messages.destroy_all
    interview.operations.destroy_all
    interview.update!(status: "ready")
    expect(Interviews::AbandonService.call(interview: interview)).to be_success
    expect(Interviews::BeginService.call(interview: interview)).not_to be_success
    expect(interview.messages).to be_empty
    expect(interview.operations).to be_empty
  end
end

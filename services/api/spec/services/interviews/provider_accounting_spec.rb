# Stage costs survive a later execution crash and separate provider calls stay distinct.
require "rails_helper"

RSpec.describe "Interview provider accounting" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:operation) { interview.operations.first }
  before { Interviews::ClaimOperationService.call(operation: operation) }
  def start(observation_id)
    Interviews::StartProviderAttemptService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, observation_id: observation_id, stage: "speech", provider: "fake", model: "scripted-v1")
  end

  it "retains known stage charges when execution dies, deduplicates reports and preserves repeated calls" do
    first, second = SecureRandom.uuid, SecureRandom.uuid
    2.times { expect(start(first)).to be_success }
    expect(start(second)).to be_success
    expect(operation.ai_task.ai_usage_attempts.where(finalized: false).count).to eq(3)
    report = { operation: operation, attempt_id: operation.attempt_id, observation_id: first,
      usage: [ { "characters" => 10, "cost_microdollars" => 7 } ] }
    travel 31.seconds
    2.times { expect(Interviews::RecordUsageService.call(**report)).to be_success }
    expect(Interviews::RecordUsageService.call(**report.merge(observation_id: second))).to be_success
    expect(operation.ai_task.reload.cost_microdollars).to eq(14)
    expect(operation.ai_task.ai_usage_attempts.find_by(attempt_id: operation.attempt_id)).not_to be_finalized
    expect(operation.ai_task.ai_usage_attempts.find_by(attempt_id: first).usage_entries.sole)
      .to have_attributes(stage: "speech", provider: "fake", model: "scripted-v1", characters: 10, cost_microdollars: 7)
    expect(Interviews::RecordUsageService.call(**report.except(:observation_id))).not_to be_success
    expect(Interviews::RecordUsageService.call(operation: operation, attempt_id: operation.attempt_id, usage: [])).to be_success
    expect(operation.ai_task.reload.cost_microdollars).to eq(14)
  end

  it "keeps unknown cost incomplete and requires explicit fake zero cost" do
    id = SecureRandom.uuid
    expect(start(id)).to be_success
    input = { operation: operation, attempt_id: operation.attempt_id, observation_id: id }
    expect(Interviews::RecordUsageService.call(**input, usage: [])).not_to be_success
    expect(Interviews::RecordUsageService.call(**input, usage: [ { "cost_microdollars" => 0 } ])).to be_success
    expect(operation.ai_task.ai_usage_attempts.find_by(attempt_id: id)).to have_attributes(finalized: true, incomplete: false)
  end

  it "rejects new provider calls from an expired execution and foreign observation identities" do
    id = SecureRandom.uuid
    expect(start(id)).to be_success
    travel 31.seconds
    expect(start(SecureRandom.uuid)).not_to be_success
    expect(Interviews::RecordUsageService.call(operation: operation, attempt_id: SecureRandom.uuid, observation_id: id, usage: [])).not_to be_success
  end
end

RSpec.describe "Interview provider attempt cap" do
  it "bounds provider calls while allowing idempotent replay at the cap" do
    stub_const("Interviews::StartProviderAttemptService::MAX_PROVIDER_ATTEMPTS", 1)
    operation = Interviews::CreateFixtureService.call(user: create(:user)).value.operations.first
    Interviews::ClaimOperationService.call(operation: operation)
    input = { operation: operation, attempt_id: operation.attempt_id, claim_generation: operation.claim_generation,
      observation_id: SecureRandom.uuid, stage: "speech", provider: "fake", model: "scripted" }
    2.times { expect(Interviews::StartProviderAttemptService.call(**input)).to be_success }
    expect(Interviews::StartProviderAttemptService.call(**input.merge(observation_id: SecureRandom.uuid))).not_to be_success
    expect(operation.execution_attempts.first.provider_attempts.count).to eq(1)
  end
end

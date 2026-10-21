# Verify paid admission and late reconciliation through the interview services.
require "rails_helper"

RSpec.describe "Interview verification allowance" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value }
  let(:operation) { interview.operations.first }
  before do
    Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
  end

  def start(id = SecureRandom.uuid, **labels)
    Interviews::StartProviderAttemptService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, observation_id: id, stage: "transcription",
      provider: "openai", model: "gpt-transcribe", **labels)
  end

  def resume
    expect(Interviews::RetryOperationService.call(operation: operation)).to be_success
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
  end

  [ [ "screening", "typesafe", "jev-1.13.0", 10_000 ],
    [ "screening", "openai", "gpt-5-nano", 50_000 ],
    [ "interviewer", "openai", "gpt-6-luna", 50_000 ] ].each do |stage, provider, model, amount|
    it "admits the reviewed #{stage}/#{model} policy and retains unknown usage" do
      id = SecureRandom.uuid
      expect(start(id, stage: stage, provider: provider, model: model)).to be_success
      expect(InterviewVerificationReservation.find_by!(observation_id: id).reserved_microdollars).to eq(amount)
      expect(start(stage: stage, provider: provider, model: model)).not_to be_success
      report = { operation: operation, attempt_id: operation.attempt_id, observation_id: id }
      expect(Interviews::RecordUsageService.call(**report, usage: [ { "input_tokens" => 100,
        "output_tokens" => 10, "cost_microdollars" => 15 } ])).to be_success
      resume
      expect(start(stage: stage, provider: provider, model: model)).to be_success
    end
  end

  it "reserves before dispatch and reconciles unknown then late known charges exactly once" do
    id = SecureRandom.uuid
    expect(start(id)).to be_success
    reservation = InterviewVerificationReservation.find_by!(observation_id: id)
    expect(reservation.reserved_microdollars).to eq(9_000)
    report = { operation: operation, attempt_id: operation.attempt_id, observation_id: id }
    expect(Interviews::RecordUsageService.call(**report, usage: [], incomplete: true)).to be_success
    expect(reservation.reload.actual_microdollars).to be_nil
    travel 31.seconds
    2.times do
      expect(Interviews::RecordUsageService.call(**report, usage: [ { "cost_microdollars" => 75, "audio_milliseconds" => 1_000 } ])).to be_success
    end
    expect(reservation.reload.actual_microdollars).to eq(75)
    expect(operation.ai_task.reload.cost_microdollars).to eq(75)
    expect(operation.ai_task.ai_usage_attempts.find_by!(attempt_id: id)).to have_attributes(incomplete: false, finalized: true)
  end

  it "uses the approved speech estimate and stops all paid work while a receipt is unknown" do
    id = SecureRandom.uuid
    expect(start(id, stage: "speech", model: "gpt-4o-mini-tts")).to be_success
    expect(InterviewVerificationReservation.find_by!(observation_id: id).reserved_microdollars).to eq(250_000)
    expect(start).not_to be_success
    report = { operation: operation, attempt_id: operation.attempt_id, observation_id: id }
    expect(Interviews::RecordUsageService.call(**report, usage: [], incomplete: true)).to be_success
    expect(start).not_to be_success
    expect(Interviews::RecordUsageService.call(**report, usage: [ { "cost_microdollars" => 1_221 } ])).to be_success
    resume
    expect(start).to be_success
  end

  it "refuses exhausted reservations, unsupported pricing and fake labels on real claims" do
    InterviewVerificationReservation.create!(observation_id: SecureRandom.uuid, reserved_microdollars: 4_995_000, actual_microdollars: 4_995_000)
    expect(start).not_to be_success
    expect(start(stage: "interviewer", model: "gpt-6-luna")).not_to be_success
    expect(start(provider: "fake", model: "scripted")).not_to be_success
    expect(operation.execution_attempts.first.provider_attempts.count).to eq(0)
  end

  it "preserves the owner's existing allowance at provider admission" do
    interview.user.update!(monthly_ai_budget_microdollars: 0)
    expect(start).not_to be_success
    expect(InterviewVerificationReservation.count).to eq(0)
  end

  it "does not release an unknown reservation on execution completion or accept false zero" do
    id = SecureRandom.uuid
    expect(start(id)).to be_success
    report = { operation: operation, attempt_id: operation.attempt_id, observation_id: id }
    expect(Interviews::RecordUsageService.call(**report, usage: [ { "cost_microdollars" => 0 } ])).not_to be_success
    expect(Interviews::RecordUsageService.call(operation: operation, attempt_id: operation.attempt_id, usage: [])).to be_success
    expect(InterviewVerificationReservation.find_by!(observation_id: id).actual_microdollars).to be_nil
  end
end

RSpec.describe "Interview allowance concurrency" do
  self.use_transactional_tests = false

  it "serializes the cumulative allowance across owners and retains it after owner deletion" do
    users = 2.times.map { create(:user) }
    operations = users.map do |user|
      interview = Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value
      operation = interview.operations.first
      Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
      operation
    end
    seed_id, *ids = 3.times.map { SecureRandom.uuid }
    InterviewVerificationReservation.create!(observation_id: seed_id, reserved_microdollars: 4_990_000, actual_microdollars: 4_990_000)
    ready, go = Queue.new, Queue.new
    threads = operations.each_with_index.map do |operation, index|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          ready << connection.select_value("SELECT pg_backend_pid()")
          go.pop
          Interviews::StartProviderAttemptService.call(operation: InterviewSessionOperation.find(operation.id),
            attempt_id: operation.attempt_id, claim_generation: operation.claim_generation,
            observation_id: ids[index], stage: "transcription", provider: "openai", model: "gpt-transcribe")
        end
      end
    end
    expect(2.times.map { Timeout.timeout(10) { ready.pop } }.uniq.size).to eq(2)
    2.times { go << true }
    results = Timeout.timeout(20) { threads.map(&:value) }
    expect(results.count(&:success?)).to eq(1)
    expect(InterviewVerificationReservation.where(observation_id: ids).sum(:reserved_microdollars)).to eq(9_000)
    users.each(&:destroy!)
    expect(InterviewVerificationReservation.where(observation_id: [ seed_id, *ids ]).sum(:reserved_microdollars)).to eq(4_999_000)
  ensure
    2.times { go << true } if go
    threads&.each(&:join)
    users&.each { |user| user.destroy! unless user.destroyed? }
    InterviewVerificationReservation.where(observation_id: [ seed_id, *ids ]).delete_all if seed_id
  end
end

RSpec.describe "Interview usage reconciliation conflicts" do
  it "does not replace known usage or release unknown costs with an empty final summary" do
    interview = Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value
    operation = interview.operations.first
    Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
    id = SecureRandom.uuid
    Interviews::StartProviderAttemptService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, observation_id: id, stage: "speech", provider: "openai", model: "gpt-4o-mini-tts")
    report = { operation: operation, attempt_id: operation.attempt_id, observation_id: id }
    expect(Interviews::RecordUsageService.call(**report, usage: [ { "cost_microdollars" => 1_221 } ])).to be_success
    expect(Interviews::RecordUsageService.call(**report, usage: [ { "cost_microdollars" => 1 } ])).not_to be_success
    expect(Interviews::RecordUsageService.call(**report, usage: [], incomplete: true)).to be_success
    expect(operation.ai_task.reload.cost_microdollars).to eq(1_221)
    expect(InterviewVerificationReservation.find_by!(observation_id: id).actual_microdollars).to eq(1_221)
  end
end

RSpec.describe "Verified operator reconciliation" do
  it "unblocks the target after evidence proves an admitted request incurred zero cost" do
    id = SecureRandom.uuid
    reservation = InterviewVerificationReservation.create!(observation_id: id, reserved_microdollars: 9_000)
    ApplicationRecord.transaction { Interviews::VerificationBudget.reconcile(observation_id: id, cost: 0) }
    expect(reservation.reload.actual_microdollars).to eq(0)
    expect(ApplicationRecord.transaction do
      Interviews::VerificationBudget.reserve(observation_id: SecureRandom.uuid,
        stage: "speech", provider: "openai", model: "gpt-4o-mini-tts")
    end).to be(true)
  end
end

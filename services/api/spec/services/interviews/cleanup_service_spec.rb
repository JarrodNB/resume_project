# Exercises audio deletion retries and dialogue expiry while keeping billing records.
require "rails_helper"

RSpec.describe Interviews::CleanupService do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:storage) { instance_double(Interviews::MediaStorage, delete: nil) }

  def audio(**attributes)
    InterviewSessionMedia.create!({ interview_session: interview, question_id: interview.questions.first.id,
      kind: "recording", status: "ready", content_type: "audio/webm", staging_key: "private/staging", sealed_key: "private/sealed",
      expires_at: 1.minute.ago, metadata: { "private" => "content" } }.merge(attributes))
  end

  it "deletes expired object copies and leaves a scrubbed tombstone" do
    record = audio
    expect(described_class.call(storage: storage).value[:deleted_media]).to eq(1)
    expect(storage).to have_received(:delete).with("private/staging")
    expect(storage).to have_received(:delete).with("private/sealed")
    expect(record.reload).to have_attributes(status: "deleted", staging_key: "private/staging", sealed_key: "private/sealed", metadata: {}, deletion_attempts: 1)
    described_class.call(storage: storage)
    expect(storage).to have_received(:delete).with("private/sealed").once
  end

  it "keeps failed deletion durable without storing provider errors and retries after backoff" do
    record = audio
    allow(storage).to receive(:delete).and_raise(StandardError, "secret signed URL")
    described_class.call(storage: storage)
    expect(record.reload).to have_attributes(status: "delete_pending", last_delete_error: "storage_delete_failed", deletion_attempts: 1)
    described_class.call(storage: storage)
    expect(record.reload.deletion_attempts).to eq(1)
    travel 5.minutes + 1.second
    allow(storage).to receive(:delete).and_return(nil)
    described_class.call(storage: storage)
    expect(record.reload).to have_attributes(status: "deleted", deletion_attempts: 2, last_delete_error: nil)
  end

  it "bounds batches and preserves unexpired audio" do
    records = 2.times.map { |i| audio(staging_key: "staging/#{i}", sealed_key: "sealed/#{i}") }
    fresh = audio(staging_key: "fresh/staging", sealed_key: "fresh/sealed", expires_at: 1.hour.from_now)
    described_class.call(limit: 1, storage: storage)
    expect(records.count { |record| record.reload.deleted? }).to eq(1)
    expect(fresh.reload).to be_ready
  end

  it "expires generated speech one hour after completion" do
    interview.update!(status: "completed", completed_at: 1.hour.ago - 1.second)
    record = audio(kind: "speech", operation_id: interview.operations.first.id, message_id: interview.messages.first.id,
      attempt_id: SecureRandom.uuid, claim_generation: 1, expires_at: 6.days.from_now)
    described_class.call(storage: storage)
    expect(record.reload).to be_deleted
  end

  it "scrubs expired dialogue and history while retaining logical tasks and usage" do
    operation = interview.operations.first
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    task = operation.reload.ai_task
    task.update!(result: { private: "dialogue" })
    interview.questions.first.update!(model_history: [ { "text" => "secret" } ])
    interview.update!(expires_at: 1.second.ago)
    expect(described_class.call(storage: storage).value[:purged_sessions]).to eq(1)
    expect(interview.reload).to have_attributes(status: "expired", fixture_context: {})
    expect(interview.content_purged_at).to be_present
    expect(interview.messages.pluck(:content).uniq).to eq([ "[expired]" ])
    expect(interview.questions.first).to have_attributes(content: "[expired]", model_history: [])
    expect(operation.reload).to have_attributes(status: "expired", accepted_result: {})
    expect(task.reload).to have_attributes(status: "failed", input: {}, result: {})
    expect(task.ai_usage_attempts.count).to eq(1)
    expect(operation.execution_attempts.count).to eq(1)
    expect(described_class.call(storage: storage).value[:purged_sessions]).to eq(0)
  end
end

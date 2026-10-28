# Exercises audio deletion retries and dialogue expiry while keeping billing records and independent career context copies.
require "rails_helper"

RSpec.describe Interviews::CleanupService do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:storage) { instance_double(Interviews::MediaStorage, delete: nil) }

  def audio(**attributes)
    InterviewSessionMedia.create!({ interview_session: interview, question_id: interview.questions.first.id,
      kind: "recording", status: "ready", content_type: "audio/webm", staging_key: "private/staging", sealed_key: "private/sealed",
      expires_at: 1.minute.ago, metadata: { "private" => "content" } }.merge(attributes))
  end

  it "keeps collectible key-only tombstones when the session and then owner are destroyed" do
    record = audio(expires_at: 1.hour.from_now)
    interview.destroy!
    expect(record.reload).to have_attributes(interview_session_id: nil, question_id: nil,
      status: "delete_pending", metadata: {}, checksum: nil, byte_size: nil)
    interview.user.destroy!
    allow(storage).to receive(:delete).and_raise(StandardError, "temporary")
    described_class.call(storage: storage)
    expect(record.reload.last_delete_error).to eq("storage_delete_failed")
    travel 5.minutes + 1.second
    allow(storage).to receive(:delete).and_return(nil)
    expect(described_class.call(storage: storage).value[:deleted_media]).to eq(1)
    travel 1.hour + 1.second
    expect(described_class.call(storage: storage).value[:reaped_media]).to eq(1)
    expect(storage).to have_received(:delete).with("private/sealed").twice
  end

  it "retains already deleted receipts through owner destruction and removes late object writes" do
    record = audio
    described_class.call(storage: storage)
    speech = audio(kind: "speech", staging_key: nil, sealed_key: "private/speech",
      operation_id: interview.operations.first.id, message_id: interview.messages.first.id,
      attempt_id: SecureRandom.uuid, claim_generation: 1, expires_at: 6.days.from_now)
    owner = interview.user
    owner.destroy!
    expect(speech.reload).to have_attributes(interview_session_id: nil, question_id: nil,
      operation_id: nil, message_id: nil, attempt_id: nil, claim_generation: nil, status: "delete_pending")
    expect(record.reload).to have_attributes(interview_session_id: nil, question_id: nil,
      operation_id: nil, message_id: nil, attempt_id: nil, claim_generation: nil, metadata: {})
    objects = { "private/sealed" => "late bytes" }
    allow(storage).to receive(:delete) { |key| objects.delete(key) }
    described_class.call(storage: storage)
    expect(objects).to be_empty
    objects["private/sealed"] = "another delayed writer"
    travel 1.hour + 1.second
    described_class.call(storage: storage)
    expect(objects).to be_empty
    expect(record.reload).to be_deleted
  end

  it "rejects detached media that still contains private metadata at the database boundary" do
    record = audio
    expect do
      InterviewSessionMedia.transaction(requires_new: true) do
        record.update_columns(interview_session_id: nil, question_id: nil, status: "delete_pending")
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /interview_media_identity/)
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
    interview.messages.first.update!(acknowledgement: "You described a private answer detail.")
    interview.update!(expires_at: 1.second.ago,
      frozen_context: { "career_focus" => "Private focus", "screened_career_focus_sha256" => "a" * 64 })
    expect(described_class.call(storage: storage).value[:purged_sessions]).to eq(1)
    expect(interview.reload).to have_attributes(status: "expired", fixture_context: {}, frozen_context: {})
    expect(interview.content_purged_at).to be_present
    expect(interview.messages.pluck(:content).uniq).to eq([ "[expired]" ])
    expect(interview.messages.pluck(:acknowledgement).compact).to be_empty
    expect(interview.questions.first).to have_attributes(content: "[expired]", model_history: [])
    expect(operation.reload).to have_attributes(status: "expired", accepted_result: {})
    expect(task.reload).to have_attributes(status: "failed", input: {}, result: {})
    expect(task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
    expect(task.ai_usage_attempts.count).to eq(1)
    expect(operation.execution_attempts.count).to eq(1)
    expect(described_class.call(storage: storage).value[:purged_sessions]).to eq(0)
  end

  it "preserves an independently saved answer in career context after its interview expires" do
    question = interview.questions.first
    original_question = question.content
    answer = interview.messages.create!(question: question, kind: "answer", position: 1,
      semantic_key: "saved-career-answer", content: "Migrated the release pipeline and reduced delays.")
    saved = CareerContexts::CreateCareerContextService.call(user: interview.user,
      attributes: { requirement: question.content, response: answer.content })
    expect(saved).to be_success
    context = saved.value
    interview.update!(expires_at: 1.second.ago)

    expect(described_class.call(storage: storage).value[:purged_sessions]).to eq(1)
    expect(answer.reload.content).to eq("[expired]")
    expect(context.reload).to have_attributes(user_id: interview.user_id, requirement: original_question,
      response: "Migrated the release pipeline and reduced delays.")
  end
end

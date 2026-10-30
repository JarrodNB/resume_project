# Verifies frozen interview evidence reuses only owner-scoped checks for exact values.
require "rails_helper"

RSpec.describe "Interview library screening" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.", screened_fields: [ "summary" ]) }

  it "captures existing field approvals without approving unchecked library fields" do
    create(:project, user: user, name: "Lab rota", description: "Scheduled technicians", screened_fields: [ "name" ])
    create(:project, user: create(:user), name: "Other owner's private project", screened_fields: [ "name" ])
    result = Interviews::StartPreparationService.call(user: user)
    expect(result).to be_success
    sources = result.value.frozen_context.fetch("sources")
    expect(sources.find { |source| source["field"] == "summary" }).to include("screened" => true)
    expect(sources.find { |source| source["text"] == "Lab rota" }).to include("screened" => true)
    expect(sources.find { |source| source["text"] == "Scheduled technicians" }).to include("screened" => false)
    expect(sources.to_json).not_to include("Other owner's")
  end

  it "hydrates legacy approvals only from exact owned current values" do
    interview = Interviews::StartPreparationService.call(user: user).value
    sources = interview.frozen_context.fetch("sources").map { |source| source.except("screened") }
    other = create(:user, summary: "Private", screened_fields: [ "summary" ])
    sources << { "type" => "profile", "id" => other.id, "field" => "summary", "text" => "Private" }
    sources << { "type" => "profile", "id" => user.id, "field" => "summary", "text" => "Older different value" }
    interview.update!(frozen_context: interview.frozen_context.merge("sources" => sources))
    result = Interviews::ClaimOperationService.call(operation: interview.operations.first, execution_mode: "real")
    expect(result).to be_success
    claimed = result.value.fetch(:payload).fetch(:frozen_context).fetch("sources")
    expect(claimed.map { |source| source["screened"] }).to eq([ true, false, false ])
    expect(interview.reload.frozen_context.fetch("sources")).to eq(claimed)
  end

  def claimed_preparation
    user.update!(screened_fields: [])
    interview = Interviews::StartPreparationService.call(user: user).value
    operation = interview.operations.first
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value
    [ interview, operation, claim.slice(:attempt_id, :claim_generation) ]
  end

  it "persists frozen checks before acceptance and reuses them on a retry without changing evidence" do
    interview, operation, identity = claimed_preparation
    2.times do
      result = Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ 0 ])
      expect(result).to be_success
      expect(result.value).to eq(screened_source_indices: [ 0 ])
    end
    expect(user.reload.screened_fields).to include("summary")
    expect(interview.reload.frozen_context.fetch("sources").first).to include("screened" => true, "text" => user.summary)
    Interviews::FailOperationService.call(operation: operation, **identity, code: "dependency_unavailable", retryable: true)
    travel 3.seconds
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
    expect(claim).to be_success
    expect(claim.value.fetch(:payload).fetch(:frozen_context).fetch("sources").first["screened"]).to be(true)
  end

  it "retains a check for frozen text without approving a later live edit" do
    interview, operation, identity = claimed_preparation
    old_text = user.summary
    user.update!(summary: "New unapproved career text")
    result = Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ 0 ])
    expect(result).to be_success
    expect(user.reload.screened_fields).to be_empty
    expect(interview.reload.frozen_context.fetch("sources").first).to include("text" => old_text, "screened" => true)
  end

  it "rejects stale claims and malformed indices without persisting any approval" do
    interview, operation, identity = claimed_preparation
    expect(Interviews::RecordLibraryScreeningService.call(operation: operation,
      **identity.merge(attempt_id: SecureRandom.uuid), source_indices: [ 0 ])).not_to be_success
    [ [ -1 ], [ 99 ], [ "0" ], [ 0, 99 ], nil ].each do |indices|
      expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: indices)).not_to be_success
    end
    operation.update!(lease_expires_at: 1.second.ago)
    expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ 0 ])).not_to be_success
    expect(interview.reload.frozen_context.fetch("sources").first["screened"]).to be(false)
    expect(user.reload.screened_fields).to be_empty
  end

  it "carries current-question accepted dialogue from Rails without leaking another session" do
    interview = Interviews::CreateFixtureService.call(user: user).value
    question = interview.questions.first
    interview.messages.create!(question: question, kind: "answer", position: 1,
      semantic_key: "test-answer", content: "I owned the calibration schedule.")
    interview.messages.create!(question: question, kind: "follow_up", position: 2,
      semantic_key: "test-follow-up", content: "What changed after that?")
    other = Interviews::CreateFixtureService.call(user: create(:user)).value
    other.messages.first.update!(content: "Private other-session dialogue")
    operation = Interviews::SubmitTurnService.call(interview: interview, question_id: question.id,
      recording_id: ready_interview_recording(interview).id, expected_revision: interview.revision,
      submission_key: "dialogue-claim").value
    result = Interviews::ClaimOperationService.call(operation: operation)
    expect(result).to be_success
    expect(result.value.fetch(:payload).fetch(:current_dialogue)).to eq([
      { kind: "opening", content: question.content },
      { kind: "answer", content: "I owned the calibration schedule." },
      { kind: "follow_up", content: "What changed after that?" }
    ])
  end

  it "keeps approval for deleted frozen evidence without approving another owner's record" do
    project = create(:project, user: user, name: "Frozen project")
    interview, operation, identity = claimed_preparation
    index = interview.frozen_context.fetch("sources").index { |source| source["id"] == project.id && source["field"] == "name" }
    project.destroy!
    other = create(:project, user: create(:user), name: "Frozen project")
    expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ index ])).to be_success
    expect(interview.reload.frozen_context.fetch("sources")[index]["screened"]).to be(true)
    expect(other.reload.screened_fields).to be_empty
  end

  it "approves live records only through the shared recorder with frozen-value fingerprints" do
    interview, operation, identity = claimed_preparation
    expect(Screening::RecordApprovalsService).to receive(:record_interview_sources).and_call_original
    expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ 0 ])).to be_success
    expect(user.reload.screened_fields).to eq([ "summary" ])
    expect(interview.reload.frozen_context.fetch("sources").first["screened"]).to be(true)
  end

  it "skips edited and deleted records and replays idempotently" do
    kept = create(:project, user: user, name: "Kept project")
    edited = create(:project, user: user, name: "Original name")
    deleted = create(:project, user: user, name: "Deleted project")
    interview, operation, identity = claimed_preparation
    sources = interview.frozen_context.fetch("sources")
    indices = [ kept, edited, deleted ].map do |project|
      sources.index { |source| source["id"] == project.id && source["field"] == "name" }
    end
    edited.update!(name: "Edited live name")
    deleted.destroy!
    results = 2.times.map { Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: indices) }
    expect(results).to all(be_success)
    expect(results.map(&:value).uniq.length).to eq(1)
    expect(kept.reload.screened_fields).to eq([ "name" ])
    expect(edited.reload.screened_fields).to eq([])
    expect(interview.reload.frozen_context.fetch("sources").values_at(*indices).map { |source| source["screened"] }).to eq([ true, true, true ])
  end
end

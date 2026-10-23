# Verifies frozen interview evidence reuses only owner-scoped checks for exact values.
require "rails_helper"

RSpec.describe "Interview library screening" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.", screened_fields: [ "summary" ]) }

  def grouped_entry(owner = user)
    result = Experiences::CreateExperienceService.call(user: owner, attributes: {
      company: "Harbor Tools", location: "Remote", description: "Entry introduction", roles: [
        { title: "Lead Engineer", start_date: "2023-01-01", description: "Lead introduction" },
        { title: "Engineer", start_date: "2020-01-01", end_date: "2022-12-31", highlights: [ { content: "Earlier role achievement" } ] }
      ], shared_highlights: [ { content: "Shared platform achievement" } ]
    })
    expect(result).to be_success
    result.value
  end

  it "freezes ordered roles and dates once with shared and role-owned bullet identities" do
    entry = grouped_entry
    separate = Experiences::CreateExperienceService.call(user: user, attributes: {
      company: entry.company, roles: [ { title: "Contract Engineer" } ]
    }).value
    entry.roles.first.update!(screened_fields: [ "title" ])
    sources = Interviews::StartPreparationService.call(user: user).value.frozen_context.fetch("sources")
    roles = sources.select { |source| source["type"] == "experience_roles" && source["field"] == "title" }
    expect(roles.select { |source| source["experience_id"] == entry.id }.map { |source| source["id"] }).to eq(entry.roles.pluck(:id))
    expect(roles.first).to include("start_date" => "2023-01-01", "end_date" => nil, "screened" => true)
    expect(roles.find { |source| source["experience_id"] == separate.id }).to include("text" => "Contract Engineer")
    expect(sources.find { |source| source["text"] == "Shared platform achievement" }).to include("experience_id" => entry.id, "experience_role_id" => nil)
    expect(sources.find { |source| source["text"] == "Earlier role achievement" }).to include("experience_id" => entry.id, "experience_role_id" => entry.roles.last.id)
    expect(sources.map { |source| [ source["type"], source["id"], source["field"] ] }.uniq.size).to eq(sources.size)
    expect(sources.count { |source| source["text"] == "Lead Engineer" }).to eq(1)
    expect(sources.map { |source| source["text"] }).to include("Entry introduction", "Lead introduction", "Remote")
  end

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

  it "approves exact owned role values once while retaining frozen approval after edits or deletion" do
    entry = grouped_entry
    role = entry.roles.first
    interview, operation, identity = claimed_preparation
    sources = interview.frozen_context.fetch("sources")
    index = sources.index { |source| source["id"] == role.id && source["field"] == "title" }
    2.times do
      expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ index ])).to be_success
    end
    expect(role.reload.screened_fields).to eq([ "title" ])
    description_index = sources.index { |source| source["id"] == role.id && source["field"] == "description" }
    role.update!(description: "Later unchecked description")
    expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ description_index ])).to be_success
    expect(role.reload.screened_fields).to eq([ "title" ])
    expect(interview.reload.frozen_context.fetch("sources")[description_index]).to include("text" => "Lead introduction", "screened" => true)
    role.destroy!
    expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ index ])).to be_success
  end

  it "hydrates only exact owned role fields and preserves legacy flat-title snapshots" do
    entry = grouped_entry
    role = entry.roles.first
    foreign = grouped_entry(create(:user)).roles.first
    role.update!(screened_fields: [ "title" ])
    foreign.update!(screened_fields: [ "title" ])
    interview, operation, identity = claimed_preparation
    legacy = { "type" => "experiences", "id" => entry.id, "field" => "title", "text" => "Old flat title" }
    sources = [
      { "type" => "experience_roles", "id" => role.id, "field" => "title", "text" => role.title },
      { "type" => "experience_roles", "id" => role.id, "field" => "title", "text" => "Old role title" },
      { "type" => "experience_roles", "id" => foreign.id, "field" => "title", "text" => foreign.title }, legacy
    ]
    interview.update!(frozen_context: interview.frozen_context.merge("sources" => sources))
    hydrated = Interviews::FrozenLibraryScreening.hydrate(interview).fetch("sources")
    expect(hydrated.map { |source| source["screened"] }).to eq([ true, false, false, false ])
    expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ 1, 2, 3 ])).to be_success
    expect(role.reload.screened_fields).to eq([ "title" ])
    expect(foreign.reload.screened_fields).to eq([ "title" ])
    expect(interview.reload.frozen_context.fetch("sources").last).to include("text" => "Old flat title", "screened" => true)
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
end

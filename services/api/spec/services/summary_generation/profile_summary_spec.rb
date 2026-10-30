# Checks the durable, owner-scoped lifecycle of a missing profile summary.
require "rails_helper"

RSpec.describe "Missing profile summary generation" do
  let(:user) { create(:user, summary: nil) }
  let!(:role) { create(:experience, user: user, title: "Backend engineer", description: "Built billing services") }
  let(:queue) { double("queue", send_message: nil) }
  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  it "queues references without copied evidence and reuses an identical pending request" do
    first = SummaryGeneration::StartGenerationService.call(user: user, target_kind: "profile")
    expect(first).to be_success
    task = first.value
    expect(task.task_type).to eq("generate_summary")
    expect(task.input).not_to have_key("sources")
    expect(task.input.to_json).not_to include("Built billing services", "Backend engineer")
    expect(task.input.fetch("source_references")).to include(a_hash_including("record_id" => role.id, "fingerprint" => Digest::SHA256.hexdigest(JSON.generate(role.description))))
    expect(user.reload.summary).to be_nil
    expect(SummaryGeneration::StartGenerationService.call(user: user, target_kind: "profile").value.id).to eq(task.id)
    expect(queue).to have_received(:send_message).once
  end
  def start
    SummaryGeneration::StartGenerationService.call(user: user, target_kind: "profile").value
  end

  def complete(task, text = "Backend engineer who builds billing services.")
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed",
      "result" => { "text" => text, "source_labels" => [ task.input.fetch("source_references").first.fetch("label") ] } })
  end

  it "keeps a reviewable proposal and accepts it once without rewriting later edits" do
    task = start
    complete(task)
    expect(user.reload.summary).to be_nil
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id)).to be_success
    expect(user.reload.summary).to eq("Backend engineer who builds billing services.")
    expect(user.screened_fields).to include("summary")
    user.update!(summary: "My later edit")
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id)).to be_success
    expect(user.reload.summary).to eq("My later edit")
  end

  it "rejects changed evidence, a new manual summary, and another user's task" do
    task = start
    complete(task)
    role.update!(description: "Newer career evidence")
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id).errors).to include("Your career information changed. Generate a new summary.")
    role.update!(description: "Built billing services")
    user.update!(summary: "A manual summary")
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id)).not_to be_success
    expect(SummaryGeneration::FinishGenerationService.call(user: create(:user), ai_task_id: task.id).errors).to eq([ "Record not found" ])
  end

  it "does not give user-edited proposal text generated screening provenance" do
    task = start
    complete(task)
    result = SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id, text: "My reviewed version")
    expect(result).to be_success
    expect(user.reload.summary).to eq("My reviewed version")
    expect(user.screened_fields).not_to include("summary")
  end

  it "rejects uncited results and allows an explicit retry after failure" do
    task = start
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "text" => "Invented", "source_labels" => [ "UNKNOWN" ] } })
    expect(task.reload).to be_failed
    expect(task.result).to be_nil
    expect(start.id).not_to eq(task.id)
  end

  it "discards pending work durably, ignores late results, and supports a fresh request" do
    task = start
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id, discard: true)).to be_success
    complete(task)
    expect(task.reload).to be_failed
    expect(user.reload.summary).to be_nil
    newer = start
    expect(newer.id).not_to eq(task.id)
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id)).not_to be_success
  end

  it "keeps screening flags and inclusion metadata out of evidence freshness" do
    task = start
    role.update!(screened_fields: [ "description" ])
    expect(SummaryGeneration::SourceReferences.stale?(user: user, task: task)).to be(false)
    expect(SummaryGeneration::ReadStateService.call(user: user, target_kind: "profile").value[:ai_task].id).to eq(task.id)
  end

  it "does not persist referenced screening receipts into changed live evidence" do
    task = start
    role.update!(description: "Unscreened replacement")
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed",
      "result" => { "text" => "Engineer", "source_labels" => [ task.input["source_references"].first["label"] ] },
      "library_screening" => [ { "record_type" => "experience", "record_id" => role.id, "fields" => [ "description" ],
        "fingerprints" => { "description" => Digest::SHA256.hexdigest(JSON.generate(role.description)) } } ] })
    expect(role.reload.screened_fields).not_to include("description")
  end

  it "does not enqueue an empty library or overwrite an existing summary" do
    empty = create(:user, summary: nil)
    expect(SummaryGeneration::StartGenerationService.call(user: empty, target_kind: "profile").errors).to include(SummaryGeneration::SourceReferences::EMPTY_MESSAGE)
    empty.update!(summary: "Existing text")
    expect(SummaryGeneration::StartGenerationService.call(user: empty, target_kind: "profile")).not_to be_success
  end

  it "does not turn a career-context requirement into qualification evidence" do
    create(:career_context, user: user, requirement: "Five years of Rails", response: "I have never used Rails")
    references = start.input["source_references"]
    expect(references.map { |source| source["label"] }).to include("CAREER_CONTEXTS_1_RESPONSE")
    expect(references.map { |source| source["label"] }).not_to include("CAREER_CONTEXTS_1_REQUIREMENT")
    expect(start.input.to_json).not_to include("I have never used Rails", "Five years of Rails")
  end

  it "retains late attempt usage once without reopening a discarded summary" do
    task = start
    SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id, discard: true)
    message = { "ai_task_id" => task.id, "status" => "completed", "attempt_id" => SecureRandom.uuid,
      "result" => { "text" => "Late result" }, "usage" => [ { "model" => "openai:gpt-5-mini", "cost_microdollars" => 7 } ] }
    2.times { AiTasks::ApplyAiResultService.call(message: message) }
    expect(task.reload).to be_failed
    expect(task.cost_microdollars).to eq(7)
    expect(user.reload.summary).to be_nil
  end

  it "rejects too many source fields before queueing" do
    stub_const("SummaryGeneration::SourceReferences::MAX_SOURCES", 1)
    expect(SummaryGeneration::StartGenerationService.call(user: user, target_kind: "profile").errors.join).to include("too large")
    expect(user.ai_tasks).to be_empty
  end

  it "keeps old copied-source tasks stale and starts fresh only on explicit request" do
    legacy = create(:ai_task, user: user, task_type: "generate_summary", status: "completed",
      input: { "target_kind" => "profile", "target_id" => user.id, "sources" => [ { "label" => "EXPERIENCES_1_TITLE", "text" => role.title } ], "source_digest" => "a" * 64 },
      result: { "text" => "Old draft", "source_labels" => [ "EXPERIENCES_1_TITLE" ] })
    expect(SummaryGeneration::ReadStateService.call(user: user, target_kind: "profile").value[:stale]).to be(true)
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: legacy.id)).not_to be_success
    expect(user.reload.summary).to be_nil
    expect(start.id).not_to eq(legacy.id)
  end

  it "rejects replacement records even when the source text is identical" do
    task = start
    complete(task)
    attributes = role.attributes.except("id", "created_at", "updated_at")
    role.destroy!
    user.experiences.create!(attributes)
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id)).not_to be_success
  end
end

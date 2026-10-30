# Checks that summary-generation screening receipts are saved only for career facts the
# task referenced, only while the live value still matches, and never for resume-section copies.
require "rails_helper"
require "digest"
require "json"

RSpec.describe SummaryGeneration::RecordScreeningService do
  let(:user) { create(:user, summary: nil) }
  let!(:role) { create(:experience, user: user, title: "Backend engineer", description: "Built billing services") }
  let!(:highlight) { create(:experience_highlight, experience: role, content: "Cut costs by half") }
  let!(:skill) { create(:skill, user: user, name: "Ruby", category: nil) }
  let(:queue) { double("queue", send_message: nil) }

  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
    allow(ApiSchema.subscriptions).to receive(:trigger)
  end

  def fingerprint(value)
    Digest::SHA256.hexdigest(JSON.generate(value))
  end

  def start
    SummaryGeneration::StartGenerationService.call(user: user, target_kind: "profile").value
  end

  def receipt(record, fields)
    { "record_type" => record.class.name.underscore, "record_id" => record.id,
      "fingerprints" => fields.to_h { |field| [ field, fingerprint(record[field]) ] } }
  end

  def apply(task, receipts)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "failed",
      "error_message" => "Generation failed", "record_screening" => receipts })
  end

  it "gives each library source its record id, with type and field named by the label, outside the digest" do
    task = start
    sources = task.input["source_references"]
    expect(sources).to include(
      a_hash_including("label" => "EXPERIENCES_1_DESCRIPTION", "record_id" => role.id),
      a_hash_including("label" => "EXPERIENCES_1_HIGHLIGHT_1", "record_id" => highlight.id),
      a_hash_including("label" => "SKILLS_1_NAME", "record_id" => skill.id))
    expect(sources.map(&:keys).uniq).to eq([ %w[label record_id fingerprint] ])
    expect(task.input["source_digest"]).to eq(Digest::SHA256.hexdigest(sources.to_json))
    expect(task.input.to_json).not_to include("Built billing services", "Cut costs by half")
    expect(SummaryGeneration::SourceReferences.record_identity("EDUCATIONS_2_FIELD_OF_STUDY")).to eq(%w[education field_of_study])
    expect(SummaryGeneration::SourceReferences.record_identity("CAREER_CONTEXTS_1_RESPONSE")).to eq(%w[career_context response])
    expect(SummaryGeneration::SourceReferences.record_identity("EXPERIENCES_3_HIGHLIGHT_2")).to eq(%w[experience_highlight content])
    expect(SummaryGeneration::SourceReferences.record_identity("SKILLS_1_UNKNOWN")).to be_nil
    expect(SummaryGeneration::SourceReferences.record_identity("SECTION_1_ITEM_1_NAME")).to be_nil
  end

  it "keeps even large-source commands content free" do
    role.update!(description: "Large evidence " * 200)
    task = start
    expect(task.input.to_json.bytesize).to be < 2500
    expect(task.input.to_json).not_to include("Large evidence")
  end

  it "approves fields whose fingerprint matches both the referenced hash and the live value, idempotently" do
    task = start
    2.times { apply(task, [ receipt(role, %w[title description]), receipt(highlight, %w[content]), receipt(skill, %w[name]) ]) }
    expect(role.reload.screened_fields).to match_array(%w[title description])
    expect(highlight.reload.screened_fields).to eq([ "content" ])
    expect(skill.reload.screened_fields).to eq([ "name" ])
  end

  it "rejects a field whose live value changed after queueing, even with a live-value fingerprint" do
    task = start
    referencedn = receipt(role, %w[description])
    role.update!(description: "Edited after queueing")
    apply(task, [ referencedn, receipt(role, %w[description]) ])
    expect(role.reload.screened_fields).to eq([])
  end

  it "rejects records and fields the command did not reference, and other users' records" do
    task = start
    later = create(:project, user: user)
    foreign = create(:skill, name: "Ruby")
    forged_foreign = receipt(foreign, %w[name])
    apply(task, [ receipt(later, %w[name]), receipt(role, %w[location]), forged_foreign,
                  forged_foreign.merge("record_id" => skill.id, "record_type" => "project"),
                  { "record_type" => "unknown", "record_id" => role.id, "fingerprints" => { "title" => fingerprint(role.title) } } ])
    expect(later.reload.screened_fields).to eq([])
    expect(foreign.reload.screened_fields).to eq([])
    expect(role.reload.screened_fields).to eq([])
    expect(skill.reload.screened_fields).to eq([])
  end

  it "never approves anything from a saved-resume summary command" do
    resume = create(:resume, user: user)
    create(:resume_section, resume: resume, section_type: "skills", position: 0,
      content: { "items" => [ { "name" => "Ruby" } ] })
    task = SummaryGeneration::StartGenerationService.call(user: user, target_kind: "resume", target_id: resume.id).value
    expect(task.input["source_references"]).to all(satisfy { |source| !source.key?("record_id") })
    apply(task, [ receipt(skill, %w[name]) ])
    expect(skill.reload.screened_fields).to eq([])
  end
end

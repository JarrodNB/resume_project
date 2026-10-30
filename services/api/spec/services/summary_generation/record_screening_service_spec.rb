# Checks that summary-generation screening receipts are saved only for career facts the
# task froze, only while the live value still matches, and never for resume-section copies.
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
    sources = task.input["sources"]
    expect(sources).to include(
      a_hash_including("label" => "EXPERIENCES_1_DESCRIPTION", "record_id" => role.id),
      a_hash_including("label" => "EXPERIENCES_1_HIGHLIGHT_1", "record_id" => highlight.id),
      a_hash_including("label" => "SKILLS_1_NAME", "record_id" => skill.id))
    expect(sources.map(&:keys).uniq).to eq([ %w[label text screened record_id] ])
    plain = sources.map { |source| source.except("screened", "record_id") }
    expect(task.input["source_digest"]).to eq(Digest::SHA256.hexdigest(plain.to_json))
    expect(SummaryGeneration::Snapshot.record_identity("EDUCATIONS_2_FIELD_OF_STUDY")).to eq(%w[education field_of_study])
    expect(SummaryGeneration::Snapshot.record_identity("CAREER_CONTEXTS_1_RESPONSE")).to eq(%w[career_context response])
    expect(SummaryGeneration::Snapshot.record_identity("EXPERIENCES_3_HIGHLIGHT_2")).to eq(%w[experience_highlight content])
    expect(SummaryGeneration::Snapshot.record_identity("SKILLS_1_UNKNOWN")).to be_nil
    expect(SummaryGeneration::Snapshot.record_identity("SECTION_1_ITEM_1_NAME")).to be_nil
  end

  it "measures the size cap without record ids, and the worst case still fits one SQS message" do
    plain = Array.new(SummaryGeneration::Snapshot::MAX_SOURCES) { |i| { "label" => "SKILLS_#{i + 1}_NAME", "text" => "", "screened" => false } }
    overhead = { "target_kind" => "profile", "target_id" => user.id, "sources" => plain, "source_digest" => "a" * 64 }.to_json.bytesize
    text = "x" * ((SummaryGeneration::Snapshot::MAX_INPUT_BYTES - overhead) / plain.length)
    sources = plain.map { |source| source.merge("text" => text, "record_id" => SecureRandom.uuid) }
    snapshot = SummaryGeneration::Snapshot.build(target_kind: "profile", target_id: user.id, sources: sources)
    expect(snapshot.to_json.bytesize).to be > SummaryGeneration::Snapshot::MAX_INPUT_BYTES
    message = { ai_task_id: SecureRandom.uuid, user_id: user.id, task_type: "generate_summary", input: snapshot }
    expect(message.to_json.bytesize).to be < 256 * 1024
    too_big = sources.map { |source| source.merge("text" => text + "xx") }
    expect { SummaryGeneration::Snapshot.build(target_kind: "profile", target_id: user.id, sources: too_big) }.to raise_error(ArgumentError, /too large/)
  end

  it "still accepts a large text-light library that fit before record ids were added" do
    # Up to the model limits, counting the role and skill created above.
    (TextLimits::MAX_EXPERIENCES - 1).times do |i|
      entry = create(:experience, user: user, company: "Company #{i}", title: "Engineer #{i}", location: "Remote", description: "d" * 300)
      12.times { |h| create(:experience_highlight, experience: entry, content: "h#{h} " + "x" * 95) }
    end
    (TextLimits::MAX_SKILLS - 1).times { |i| create(:skill, user: user, name: "Skill #{i}", category: "Category") }
    snapshot = SummaryGeneration::Snapshot.capture(user: user, target_kind: "profile")
    expect(snapshot["sources"].length).to be > 900
    expect(snapshot.to_json.bytesize).to be > SummaryGeneration::Snapshot::MAX_INPUT_BYTES
  end

  it "approves fields whose fingerprint matches both the frozen snapshot and the live value, idempotently" do
    task = start
    2.times { apply(task, [ receipt(role, %w[title description]), receipt(highlight, %w[content]), receipt(skill, %w[name]) ]) }
    expect(role.reload.screened_fields).to match_array(%w[title description])
    expect(highlight.reload.screened_fields).to eq([ "content" ])
    expect(skill.reload.screened_fields).to eq([ "name" ])
  end

  it "rejects a field whose live value changed after queueing, even with a live-value fingerprint" do
    task = start
    frozen = receipt(role, %w[description])
    role.update!(description: "Edited after queueing")
    apply(task, [ frozen, receipt(role, %w[description]) ])
    expect(role.reload.screened_fields).to eq([])
  end

  it "rejects records and fields the snapshot did not freeze, and other users' records" do
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

  it "never approves anything from a saved-resume summary snapshot" do
    resume = create(:resume, user: user)
    create(:resume_section, resume: resume, section_type: "skills", position: 0,
      content: { "items" => [ { "name" => "Ruby" } ] })
    task = SummaryGeneration::StartGenerationService.call(user: user, target_kind: "resume", target_id: resume.id).value
    expect(task.input["sources"]).to all(satisfy { |source| !source.key?("record_id") })
    apply(task, [ receipt(skill, %w[name]) ])
    expect(skill.reload.screened_fields).to eq([])
  end
end

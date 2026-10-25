# Verify reusable Job checks through final task results and ordinary saved-job edits.
require "rails_helper"
require "digest"
require "json"

RSpec.describe "Saved job screening" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, nice_to_haves: [ "Helpful" ]) }
  let(:task) { create(:ai_task, user: user, subject: job, input: { job_id: job.id }) }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  def report(record = job, fields = %w[title company requirements nice_to_haves])
    { "job_id" => record.id,
      "fields" => fields.to_h { |field| [ field, Digest::SHA256.hexdigest(JSON.generate(record[field])) ] } }
  end

  def apply(reports, status: "failed", target: task)
    AiTasks::ApplyAiResultService.call(message: {
      "ai_task_id" => target.id, "status" => status, "error_message" => "Generation failed",
      "result" => {}, "job_screening" => reports
    })
  end

  it "persists every checked field even if generation fails, once" do
    reports = [ report ]
    2.times { expect(apply(reports)).to be_success }
    expect(job.reload.screened_fields).to match_array(%w[title company requirements nice_to_haves])
  end

  it "approves only the owned task-associated job and matching allowlisted values" do
    other_owned = create(:job, user: user)
    foreign = create(:job)
    stale = report
    job.update!(requirements: [ "New unchecked requirement" ])
    stale["fields"]["notes"] = Digest::SHA256.hexdigest(JSON.generate(job.notes))
    expect(apply([ report(other_owned), report(foreign), stale, nil, { "job_id" => job.id, "fields" => [] } ])).to be_success
    expect(job.reload.screened_fields).to match_array(%w[title company nice_to_haves])
    expect(other_owned.reload.screened_fields).to be_empty
    expect(foreign.reload.screened_fields).to be_empty
  end

  it "does not approve deleted jobs, unrelated tasks or usage-only messages" do
    reports = [ report ]
    expect(apply(reports, target: create(:ai_task, user: user))).to be_success
    message = { "ai_task_id" => task.id, "status" => "usage", "attempt_id" => SecureRandom.uuid, "job_screening" => reports }
    expect(AiTasks::ApplyAiResultService.call(message: message)).to be_success
    expect(job.reload.screened_fields).to be_empty
    deleted_task = task
    job.destroy!
    expect(apply(reports, target: deleted_task)).to be_success
  end

  it "invalidates only edits and cannot restore them on final result redelivery" do
    reports = [ report ]
    expect(apply(reports)).to be_success
    expect(Jobs::UpdateJobService.call(job: job, attributes: { requirements: [ "Edited" ], notes: "Private note" })).to be_success
    expect(job.reload.screened_fields).to match_array(%w[title company nice_to_haves])
    expect(apply(reports)).to be_success
    expect(job.reload.screened_fields).not_to include("requirements")
  end

  it "reloads stale editors before invalidating fields and preserves unchanged updates" do
    editor = Job.find(job.id)
    expect(apply([ report ])).to be_success
    expect(Jobs::UpdateJobService.call(job: editor, attributes: { title: "Edited title" })).to be_success
    expect(job.reload.screened_fields).to match_array(%w[company requirements nice_to_haves])
    expect(Jobs::UpdateJobService.call(job: job, attributes: { company: job.company, notes: "note" })).to be_success
    expect(Jobs::MoveJobToStageService.call(job: job, stage: "applied")).to be_success
    expect(job.reload.screened_fields).to match_array(%w[company requirements nice_to_haves])
  end

  it "does not persist invalid edits or their approval invalidation" do
    expect(apply([ report ])).to be_success
    expect(Jobs::UpdateJobService.call(job: job, attributes: { title: "" })).not_to be_success
    expect(job.reload.title).to eq("AI Engineer")
    expect(job.screened_fields).to match_array(%w[title company requirements nice_to_haves])
  end

  it "invalidates a whole ordered requirement list on reordering, retaining unrelated checks" do
    expect(apply([ report ])).to be_success
    expect(Jobs::UpdateJobService.call(job: job, attributes: { requirements: job.requirements.reverse })).to be_success
    expect(job.reload.screened_fields).to match_array(%w[title company nice_to_haves])
  end

  it "clears approval when company is removed and a nice-to-have is changed" do
    expect(apply([ report ])).to be_success
    expect(Jobs::UpdateJobService.call(job: job, attributes: { company: " ", nice_to_haves: [ "New preference" ] })).to be_success
    expect(job.reload.company).to be_nil
    expect(job.screened_fields).to match_array(%w[title requirements])
  end

  it "starts manually created and existing jobs without approvals" do
    expect(job.screened_fields).to be_empty
    created = Jobs::CreateJobService.call(user: user, attributes: { title: "New job" })
    expect(created).to be_success
    expect(created.value.screened_fields).to be_empty
  end

  it "matches Python fingerprints for Unicode, escaping and typed ordered lists" do
    cases = JSON.parse(File.read(Rails.root.join("../ai/tests/fixtures/job_field_fingerprints.json")))
    cases.each do |item|
      expect(Jobs::RecordScreeningService.field_fingerprint(item["value"])).to eq(item["sha256"])
    end
  end
end

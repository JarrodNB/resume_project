# Exercise saved answer screening through final results, task snapshots and ordinary edits.
require "rails_helper"
require "digest"
require "json"

RSpec.describe "Saved gap response screening" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:response) { create(:job_gap_response, job: job) }
  let(:task) do
    create(:ai_task, user: user, subject: job, task_type: "tailor_resume", input: {
      "job_id" => job.id, "gap_responses" => [ response.attributes.slice("id", "requirement", "body") ]
    })
  end

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  def report(record = response, fields = %w[requirement body])
    { "record_type" => "gap_response", "record_id" => record.id,
      "fingerprints" => fields.to_h { |field| [ field, Digest::SHA256.hexdigest(JSON.generate(record[field])) ] } }
  end

  def apply(reports, status: "failed", target: task)
    AiTasks::ApplyAiResultService.call(message: {
      "ai_task_id" => target.id, "status" => status, "error_message" => "Generation failed",
      "result" => {}, "record_screening" => reports
    })
  end

  it "remembers checked fields even if generation fails" do
    expect(apply([ report ])).to be_success
    expect(response.reload.attributes["screened_fields"]).to match_array(%w[requirement body])
  end

  it "approves every snapshotted response in a grouped result" do
    other = create(:job_gap_response, job: job, requirement: "Another requirement", body: response.body)
    task.input["gap_responses"] << other.attributes.slice("id", "requirement", "body")
    task.save!
    expect(apply([ report, report(other) ])).to be_success
    expect(response.reload.screened_fields).to match_array(%w[requirement body])
    expect(other.reload.screened_fields).to match_array(%w[requirement body])
  end

  it "limits approval to owned, snapshotted records and matching allowlisted fields" do
    other = create(:job_gap_response, job: job, requirement: "Not in snapshot")
    other_job = create(:job_gap_response, job: create(:job, user: user))
    foreign = create(:job_gap_response)
    stale = report
    task # freeze the queued snapshot before the edit
    response.update!(body: "Edited after queueing")
    stale["fingerprints"]["career_context_id"] = Digest::SHA256.hexdigest(JSON.generate(response.career_context_id))
    malformed = [ nil, {}, { "response_id" => response.id, "fingerprints" => [] },
      { "response_id" => response.id, "fingerprints" => { "body" => nil } },
      { "response_id" => "bad-uuid", "fingerprints" => {} } ]
    task.input["gap_responses"] << { "id" => "bad-uuid", "requirement" => "Bad", "body" => "Bad" }
    task.save!
    expect(apply([ report(other), report(other_job), report(foreign), stale, *malformed ])).to be_success
    expect(response.reload.screened_fields).to eq([ "requirement" ])
    [ other, other_job, foreign ].each { |record| expect(record.reload.screened_fields).to be_empty }
  end

  it "does not approve values absent from the task snapshot even if they match current text" do
    task
    response.update!(body: "Later text")
    expect(apply([ report ])).to be_success
    expect(response.reload.screened_fields).to eq([ "requirement" ])
  end

  it "ignores usage-only messages, other task kinds, and legacy snapshots" do
    reports = [ report ]
    expect(apply(reports, status: "usage")).not_to be_success # usage identity is required
    expect(AiTasks::ApplyAiResultService.call(message: {
      "ai_task_id" => task.id, "status" => "usage", "attempt_id" => SecureRandom.uuid,
      "record_screening" => reports
    })).to be_success
    expect(apply(reports, target: create(:ai_task, user: user, subject: job))).to be_success
    task.update!(input: { "gap_responses" => [ response.attributes.slice("requirement", "body") ] })
    expect(apply(reports)).to be_success
    expect(response.reload.screened_fields).to be_empty
  end

  it "ignores deleted answers and their replacements with the same text" do
    reports = [ report ]
    task
    original = response.attributes.slice("requirement", "body")
    response.destroy!
    replacement = create(:job_gap_response, job: job, **original.symbolize_keys)
    expect(apply(reports)).to be_success
    expect(replacement.reload.screened_fields).to be_empty
  end

  it "ignores deleted jobs" do
    reports = [ report ]
    task
    job.destroy!
    expect(apply(reports)).to be_success
  end

  it "invalidates changed body only, preserving checks on unchanged saves and library toggles" do
    expect(apply([ report ])).to be_success
    expect(GapResponses::SaveGapResponseService.call(job: job, requirement: response.requirement,
      body: response.body, add_to_library: true)).to be_success
    expect(response.reload.screened_fields).to match_array(%w[requirement body])
    expect(response.career_context.screened_fields).to be_empty
    expect(GapResponses::SaveGapResponseService.call(job: job, requirement: response.requirement,
      body: "Changed answer", add_to_library: false)).to be_success
    expect(response.reload.screened_fields).to eq([ "requirement" ])
    expect(apply([ report ])).to be_success # finished task redelivery cannot restore body
    expect(response.reload.screened_fields).to eq([ "requirement" ])
  end

  it "reloads a stale answer before saving edits" do
    stale_editor = job.gap_responses.find(response.id)
    expect(apply([ report ])).to be_success
    allow(job.gap_responses).to receive(:find_by).with(requirement: response.requirement).and_return(stale_editor)
    expect(GapResponses::SaveGapResponseService.call(job: job, requirement: response.requirement,
      body: "Edited after screening", add_to_library: false)).to be_success
    expect(response.reload.screened_fields).to eq([ "requirement" ])
  end

  it "rolls back invalid edits and approval invalidation" do
    expect(apply([ report ])).to be_success
    original_body = response.body
    expect(GapResponses::SaveGapResponseService.call(job: job, requirement: response.requirement,
      body: "x" * (TextLimits::PROSE + 1), add_to_library: false)).not_to be_success
    expect(response.reload.body).to eq(original_body)
    expect(response.screened_fields).to match_array(%w[requirement body])
  end

  it "starts new answers unchecked and shares canonical fingerprint vectors with Python" do
    expect(response.screened_fields).to be_empty
    cases = JSON.parse(File.read(Rails.root.join("../ai/tests/fixtures/job_field_fingerprints.json")))
    cases.each do |item|
      expect(Screening::RecordApprovalsService.field_fingerprint(item["value"])).to eq(item["sha256"])
    end
  end
end

# Successful screening reports update only the task owner's unchanged saved records.
require "rails_helper"

RSpec.describe AiTasks::ApplyAiResultService do
  let(:user) { create(:user) }
  let(:task) { create(:ai_task, user: user) }
  let(:job) { create(:job, user: user) }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  def report(record, **changes)
    { "record_type" => record.class.name, "record_id" => record.id,
      "observed_updated_at" => record.updated_at.iso8601(6), "screening_policy_version" => "policy-1" }.merge(changes.stringify_keys)
  end

  def deliver(successes, status: "failed", **fields)
    described_class.call(message: { "ai_task_id" => task.id, "status" => status,
      "screening_successes" => successes }.merge(fields.stringify_keys))
  end

  it "persists successful screening even when generation failed, without changing the content version" do
    version = job.updated_at
    expect(deliver([ report(job) ])).to be_success
    expect(job.reload).to have_attributes(screening_policy_version: "policy-1", updated_at: version)
    expect(job.screened_at).to be_present
    expect(task.reload).to be_failed
  end

  it "accepts late successes and usage once while preserving finished outcomes" do
    task.update!(status: "completed", result: { "saved" => true })
    message = { attempt_id: SecureRandom.uuid, usage: [ { "input_tokens" => 10, "cost_microdollars" => 3 } ] }
    2.times { deliver([ report(job) ], status: "usage", **message) }
    expect(job.reload.screened_at).to be_present
    expect(task.reload).to have_attributes(status: "completed", result: { "saved" => true }, input_tokens: 10, cost_microdollars: 3)
  end

  it "skips stale, deleted, foreign, and malformed reports without losing valid successes or accounting" do
    stale = report(job)
    job.update!(title: "Changed")
    foreign = create(:job)
    deleted = create(:skill, user: user)
    gone = report(deleted)
    deleted.destroy!
    valid = create(:project, user: user)
    entries = [ stale, report(foreign), gone, nil, "bad", {}, report(valid, observed_updated_at: "yesterday"),
      report(valid, record_type: "AiTask"), report(valid, record_id: "not-a-uuid"),
      report(valid, screening_policy_version: {}), report(valid, screening_policy_version: "bad\u0000policy"),
      report(valid, screening_policy_version: "x" * 256), report(valid, observed_updated_at: "0000-01-01T00:00:00Z"), report(valid) ]
    expect(deliver(entries, input_tokens: 7)).to be_success
    expect(job.reload.screened_at).to be_nil
    expect(foreign.reload.screened_at).to be_nil
    expect(valid.reload.screening_policy_version).to eq("policy-1")
    expect(task.reload).to have_attributes(status: "failed", input_tokens: 0)
  end

  it "resolves the summary and association-owned question through the task owner" do
    question = InterviewQuestionSet.create!(user: user, number: 1).questions.create!(position: 1, question_text: "Tell me about your work")
    foreign_question = InterviewQuestionSet.create!(user: create(:user), number: 1).questions.create!(position: 1, question_text: "Tell me about your work")
    deliver([ report(user), report(question), report(foreign_question) ])
    expect(user.reload.screened_at).to be_present
    expect(question.reload.screened_at).to be_present
    expect(foreign_question.reload.screened_at).to be_nil
  end

  it "cannot restore a parent's check after a child-only edit, including when no former check was saved" do
    role = create(:experience, user: user)
    create(:experience_highlight, experience: role, content: "Original")
    observed = report(role)
    travel_to(1.second.from_now) do
      Experiences::UpdateExperienceService.call(experience: role, attributes: {}, highlights: [ "New content" ])
      deliver([ observed ])
    end
    expect(role.reload.screened_at).to be_nil
  end

  it "applies all allowlisted source types and ignores malformed optional list values" do
    records = %i[experience project education certification skill library_fact].map { |type| create(type, user: user) }
    records << create(:job_gap_response, job: job)
    expect(deliver({ "bad" => true })).to be_success
    expect(deliver(records.map { |record| report(record) })).to be_success
    expect(records.map { |record| record.reload.screening_policy_version }).to all(eq("policy-1"))
  end

  it "rejects pre-edit results when the clock has not advanced for a text or child-only edit" do
    freeze_time do
      project = create(:project, user: user)
      role = create(:experience, user: user)
      create(:experience_highlight, experience: role, content: "Original")
      reports = [ report(project), report(role) ]
      versions = [ project.updated_at, role.updated_at ]

      Projects::UpdateProjectService.call(project: project, attributes: { description: "Changed" })
      Experiences::UpdateExperienceService.call(experience: role, attributes: {}, highlights: [ "Changed" ])
      deliver(reports)

      [ project, role ].each_with_index do |record, index|
        aggregate_failures(record.class.name) do
          expect(record.reload.screened_at).to be_nil
          expect(record.updated_at).to be > versions[index]
        end
      end
    end
  end
end

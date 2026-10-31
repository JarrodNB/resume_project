# Description: Starting a tailor_resume task, including returning one already in progress.
require "rails_helper"

RSpec.describe ResumeTailoring::StartResumeTailoringService do
  let(:user) { create(:user, name: "Ada Lovelace", contact_email: "ada@example.com") }
  let(:job) { create(:job, user: user) }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }
  let(:gap_analysis) do
    { "summary" => "Close match.", "assessments" => [
      { "kind" => "required", "requirement" => "Python", "verdict" => "met",
        "explanation" => "Built Python services.", "evidence" => [] }
    ] }
  end

  before do
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    create(:ai_task, user: user, subject: job, task_type: "analyze_gaps", status: "completed", result: { "gap_analysis" => gap_analysis })
  end

  it "queues only job/comparison references and the summary option" do
    create(:job_gap_response, job: job, requirement: "Python", body: "Five years.", screened_fields: [ "requirement" ])

    result = described_class.call(user: user, job: job)

    expect(result).to be_success
    task = result.value
    expect(task).to be_tailor_resume.and be_queued
    expect(task.subject).to eq(job)
    expect(task.input.keys).to contain_exactly("job_id", "analysis_task_id", "include_summary")
    expect(task.input["analysis_task_id"]).to eq(job.ai_tasks.analyze_gaps.completed.first.id)
    expect(queue).to have_received(:send_message)
  end

  it "captures the scalar library default without changing resumed drafts" do
    User.find(user.id).update!(include_summary: false)
    expect(user.include_summary).to be(true) # The caller may hold a stale account instance.
    task = described_class.call(user: user, job: job).value
    expect(task.input["include_summary"]).to be(false)
    user.update!(include_summary: true)
    expect(described_class.call(user: user, job: job).value).to eq(task)
    expect(task.reload.input["include_summary"]).to be(false)
  end

  it "queues a tailor task when no comparison has finished" do
    job.ai_tasks.analyze_gaps.delete_all

    result = described_class.call(user: user, job: job)

    expect(result).to be_success
    expect(result.value.input["analysis_task_id"]).to be_nil
    expect(queue).to have_received(:send_message)
  end

  it "returns the completed unsaved draft instead of starting another" do
    existing = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed",
                      result: { "sections" => [
                        { "section_type" => "custom", "content" => {} },
                        { "section_type" => "summary", "content" => { "text" => "Engineer." } }
                      ] })

    result = described_class.call(user: user, job: job)

    expect(result.value).to eq(existing)
    expect(queue).not_to have_received(:send_message)
  end

  it "starts a new task when the unsaved completed result uses the retired draft format" do
    old = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed",
                 result: { "drafts" => [], "markdown" => "Old draft" })

    result = described_class.call(user: user, job: job)

    expect(result).to be_success
    expect(result.value).to be_queued
    expect(result.value.id).not_to eq(old.id)
    expect(queue).to have_received(:send_message).once
  end

  {
    "unsupported" => { "section_type" => "custom", "content" => {} },
    "omitted" => { "section_type" => "summary", "content" => { "text" => "Old draft" }, "omitted" => true },
    "malformed content" => { "section_type" => "summary", "content" => "Malformed draft" }
  }.each do |shape, section|
    it "starts a new task when the completed result has only #{shape} sections" do
      old = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed",
                   result: { "sections" => [ section ] })

      result = described_class.call(user: user, job: job)

      expect(result).to be_success
      expect(result.value).to be_queued
      expect(result.value.id).not_to eq(old.id)
      expect(described_class.call(user: user, job: job).value).to eq(result.value)
      expect(queue).to have_received(:send_message).once
    end
  end

  it "returns an in-flight queued draft after reloading the page" do
    existing = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "queued")

    result = described_class.call(user: user, job: job.reload)

    expect(result.value).to eq(existing)
    expect(queue).not_to have_received(:send_message)
  end

  it "queues a fresh attempt after a failed draft without changing the old outcome" do
    failed = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "failed", error_message: "Timed out")

    result = described_class.call(user: user, job: job)

    expect(result).to be_success
    expect(result.value).to be_queued
    expect(result.value.id).not_to eq(failed.id)
    expect(failed.reload).to be_failed
    expect(failed.error_message).to eq("Timed out")
    expect(queue).to have_received(:send_message).once
  end

  it "refuses once the resume has been saved" do
    create(:resume, user: user, job: job)
    create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed", accepted_at: Time.current)

    result = described_class.call(user: user, job: job)

    expect(result.errors).to eq([ described_class::ALREADY_SAVED_MESSAGE ])
  end

  it "starts fresh after deletion without changing the accepted task" do
    accepted = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed", accepted_at: Time.current)
    accepted_at = accepted.accepted_at
    resume = create(:resume, user: user, job: job)
    Records::DestroyRecordService.call(record: resume)

    result = described_class.call(user: user, job: job)

    expect(result).to be_success
    expect(result.value.id).not_to eq(accepted.id)
    expect(result.value).to be_queued
    expect(accepted.reload.accepted_at).to eq(accepted_at)
    expect(queue).to have_received(:send_message).once
  end

  it "blocks generation for a saved resume even when the latest task is not accepted" do
    create(:resume, user: user, job: job)
    create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "failed")

    result = described_class.call(user: user, job: job)

    expect(result.errors).to eq([ described_class::ALREADY_SAVED_MESSAGE ])
    expect(queue).not_to have_received(:send_message)
  end

  it "resumes at the usage cap and publishes no duplicate task" do
    existing = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "queued")
    user.update!(ai_tasks_per_hour_limit: 1)

    2.times do
      expect(described_class.call(user: user.reload, job: job.reload).value).to eq(existing)
    end

    expect(job.ai_tasks.tailor_resume.count).to eq(1)
    expect(queue).not_to have_received(:send_message)
  end
end

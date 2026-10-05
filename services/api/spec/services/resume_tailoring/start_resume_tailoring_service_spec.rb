# Description: Starting a tailor_resume task, including returning one already in progress.
require "rails_helper"

RSpec.describe ResumeTailoring::StartResumeTailoringService do
  let(:user) { create(:user, name: "Ada Lovelace", contact_email: "ada@example.com") }
  let(:job) { create(:job, user: user) }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before do
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    create(:ai_task, user: user, subject: job, task_type: "analyze_gaps", status: "completed", result: { "gap_analysis" => { "summary" => "Close match." } })
  end

  it "queues a tailor task with the profile, the comparison, and gap responses" do
    create(:job_gap_response, job: job, requirement: "Python", body: "Five years.")

    result = described_class.call(user: user, job: job)

    expect(result).to be_success
    task = result.value
    expect(task).to be_tailor_resume.and be_queued
    expect(task.subject).to eq(job)
    expect(task.generation).to eq(0)
    expect(task.input["contact"]).to include("full_name" => "Ada Lovelace", "email" => "ada@example.com")
    expect(task.input["gap_analysis"]).to eq("summary" => "Close match.")
    expect(task.input["gap_responses"]).to eq([ { "requirement" => "Python", "body" => "Five years." } ])
    expect(queue).to have_received(:send_message)
  end

  it "refuses before a comparison has finished" do
    job.ai_tasks.analyze_gaps.delete_all

    result = described_class.call(user: user, job: job)

    expect(result.errors).to eq([ described_class::NEEDS_COMPARISON_MESSAGE ])
    expect(queue).not_to have_received(:send_message)
  end

  it "returns the task already waiting on the user instead of starting another" do
    existing = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "needs_user_input")

    result = described_class.call(user: user, job: job)

    expect(result.value).to eq(existing)
    expect(queue).not_to have_received(:send_message)
  end

  it "refuses once the resume has been saved" do
    create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed", accepted_at: Time.current)

    result = described_class.call(user: user, job: job)

    expect(result.errors).to eq([ described_class::ALREADY_SAVED_MESSAGE ])
  end
end

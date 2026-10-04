# Description: Queueing an analyze_gaps task for a job and the user's career library.
require "rails_helper"

RSpec.describe GapAnalysis::StartGapAnalysisService do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before do
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    create(:skill, user: user)
  end

  it "queues an analyze_gaps task about the job with only the job id as input" do
    result = described_class.call(user: user, job: job)

    expect(result).to be_success
    expect(result.value).to be_analyze_gaps.and be_queued
    expect(result.value.subject).to eq(job)
    expect(result.value.input).to eq("job_id" => job.id)
    expect(queue).to have_received(:send_message)
  end

  it "accepts a job with only nice-to-haves" do
    job.update!(requirements: [], nice_to_haves: [ "Kubernetes" ])

    expect(described_class.call(user: user, job: job)).to be_success
  end

  it "refuses a job with no requirements or nice-to-haves" do
    job.update!(requirements: [], nice_to_haves: [])

    result = described_class.call(user: user, job: job)

    expect(result.errors).to eq([ described_class::NO_REQUIREMENTS_MESSAGE ])
    expect(queue).not_to have_received(:send_message)
  end

  it "refuses when the career library is empty" do
    user.skills.destroy_all

    result = described_class.call(user: user, job: job)

    expect(result.errors).to eq([ described_class::EMPTY_LIBRARY_MESSAGE ])
  end

  it "counts any library entry, not only skills" do
    user.skills.destroy_all
    create(:education, user: user)

    expect(described_class.call(user: user, job: job)).to be_success
  end

  it "refuses while an analysis of the same job is queued" do
    create(:ai_task, user: user, task_type: "analyze_gaps", subject: job)

    result = described_class.call(user: user, job: job)

    expect(result.errors).to eq([ described_class::ALREADY_RUNNING_MESSAGE ])
  end

  it "allows a new analysis once the previous one finished, or another job's is running" do
    create(:ai_task, user: user, task_type: "analyze_gaps", subject: job, status: "completed")
    create(:ai_task, user: user, task_type: "analyze_gaps", subject: create(:job, user: user))

    expect(described_class.call(user: user, job: job)).to be_success
  end

  it "doesn't let a stuck queued analysis block the job forever" do
    travel_to(1.hour.ago) { create(:ai_task, user: user, task_type: "analyze_gaps", subject: job) }

    expect(described_class.call(user: user, job: job)).to be_success
  end
end

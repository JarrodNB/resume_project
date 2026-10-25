# Checks safe notice copy and owned result links for every kind of AI task.
require "rails_helper"

RSpec.describe AiTasks::DescribeTaskOutcomeService do
  def describe_outcome(task, status: "completed")
    outcome = AiTaskOutcome.new(user: task.user, ai_task: task, task_type: task.task_type,
      status: status, completed_at: Time.current)
    described_class.call(outcome: outcome).value
  end

  it "labels every task type and both terminal outcomes without exposing private content" do
    AiTask::TASK_TYPES.each do |type|
      task = build(:ai_task, id: SecureRandom.uuid, task_type: type, input: { secret: "private input" }, error_message: "provider secret")
      %w[completed failed].each do |status|
        notice = describe_outcome(task, status: status)
        expect(notice[:title]).to end_with(status)
        expect(notice[:title]).not_to include("private input", "provider secret")
        expect(notice[:destination]).to start_with("/")
      end
    end
  end

  it "links job results and falls back when the job is deleted or belongs to someone else" do
    task = create(:ai_task, subject: create(:job))
    expect(describe_outcome(task)[:destination]).to eq("/jobs")
    job = create(:job, user: task.user)
    task.update!(subject: job)
    expect(describe_outcome(task)[:destination]).to eq("/jobs/#{job.id}")
    job.destroy!
    expect(describe_outcome(task.reload)[:destination]).to eq("/jobs")
  end

  it "links imported jobs on success and their task recovery page on failure" do
    user = create(:user)
    job = create(:job, user: user)
    task = create(:ai_task, user: user, task_type: "parse_job_posting", subject: job)
    expect(describe_outcome(task)[:destination]).to eq("/jobs/#{job.id}")
    expect(describe_outcome(task, status: "failed")[:destination]).to eq("/jobs/paste/#{task.id}")
  end
end

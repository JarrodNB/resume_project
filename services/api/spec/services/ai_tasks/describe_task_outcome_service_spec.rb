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

  it "labels study guides and links both outcomes to the owned job with a safe fallback" do
    user = create(:user)
    job = create(:job, user: user)
    task = create(:ai_task, user: user, task_type: "generate_study_guide", subject: job)
    %w[completed failed].each do |status|
      expect(describe_outcome(task, status: status)).to eq(
        title: "Study guide #{status}", destination: "/jobs/#{job.id}")
    end
    job.destroy!
    expect(describe_outcome(task.reload)[:destination]).to eq("/jobs")
    task.update!(subject: create(:job))
    expect(describe_outcome(task)[:destination]).to eq("/jobs")
  end

  it "opens the jobs overview for a completed import whose saved job was deleted" do
    user = create(:user)
    %w[scrape_job parse_job_posting].each do |type|
      job = create(:job, user: user)
      task = create(:ai_task, user: user, task_type: type, subject: job)
      job.destroy!
      expect(describe_outcome(task.reload)[:destination]).to eq("/jobs")
      retry_path = type == "scrape_job" ? "/jobs/new/#{task.id}" : "/jobs/paste/#{task.id}"
      expect(describe_outcome(task, status: "failed")[:destination]).to eq(retry_path)
    end
  end

  it "links search, resume import, and practice results to their current web pages" do
    user = create(:user)
    expect(describe_outcome(build(:ai_task, user: user, task_type: "rerank_job_listings"))[:destination]).to eq("/jobs/find")
    import_task = create(:ai_task, user: user, task_type: "parse_resume")
    expect(describe_outcome(import_task)[:destination]).to eq("/library/import/#{import_task.id}")
    expect(describe_outcome(build(:ai_task, user: user, task_type: "generate_interview_questions"))[:destination]).to eq("/practice/questions")
    expect(describe_outcome(build(:ai_task, user: user, task_type: "interview_turn"))[:destination]).to eq("/practice/interviews")
  end
end

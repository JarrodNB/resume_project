# Description: Each saved job's suggested next step, ownership of the tasks it reads, and a
# fixed query count regardless of how many jobs the user has.
require "rails_helper"

RSpec.describe Jobs::BuildPipelineService do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }

  def gap_task(status, owner: user, at: Time.current)
    create(:ai_task, user: owner, subject: job, task_type: "analyze_gaps", status: status, created_at: at)
  end

  def tailor_task(status, accepted_at: nil, at: Time.current)
    create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: status,
      accepted_at: accepted_at, created_at: at)
  end

  def next_step(for_job = job)
    described_class.call(user: user).value.find { _1[:job].id == for_job.id }[:next_step]
  end

  describe "rules" do
    it "suggests comparing a new job with no tasks" do
      expect(next_step).to eq("compare")
    end

    it "reports a running comparison while the latest gap analysis is queued or waiting on the user" do
      gap_task("completed", at: 2.minutes.ago)
      gap_task("needs_user_input")
      tailor_task("queued")
      expect(next_step).to eq("comparison_running")
    end

    it "reports a running resume when there is no resume and tailoring is in progress" do
      gap_task("failed")
      tailor_task("needs_user_input")
      expect(next_step).to eq("resume_running")
    end

    it "ignores in-progress tailoring once a resume is saved" do
      gap_task("completed")
      tailor_task("queued")
      create(:resume, user: user, job: job)
      expect(next_step).to eq("ready_to_apply")
    end

    it "reports a failed comparison" do
      gap_task("failed")
      tailor_task("failed")
      expect(next_step).to eq("comparison_failed")
    end

    it "reports a failed resume when there is no resume" do
      gap_task("completed")
      tailor_task("failed")
      expect(next_step).to eq("resume_failed")
    end

    it "asks to review a completed, unaccepted resume draft" do
      gap_task("completed")
      tailor_task("completed")
      expect(next_step).to eq("review_resume_draft")
    end

    it "asks to write a resume after a completed comparison, including after an accepted draft" do
      gap_task("completed")
      tailor_task("completed", accepted_at: Time.current)
      expect(next_step).to eq("write_resume")
    end

    it "uses only the newest task of each type" do
      gap_task("failed", at: 2.minutes.ago)
      gap_task("completed", at: 1.minute.ago)
      tailor_task("failed", at: 2.minutes.ago)
      tailor_task("completed", accepted_at: Time.current, at: 1.minute.ago)
      expect(next_step).to eq("write_resume")
    end

    it "is ready to apply with a completed comparison and a saved resume" do
      gap_task("completed")
      create(:resume, user: user, job: job)
      expect(next_step).to eq("ready_to_apply")
    end

    it "suggests comparing when a resume exists but no comparison ever completed" do
      create(:resume, user: user, job: job)
      expect(next_step).to eq("compare")
    end

    it "follows the stage once no AI work needs attention" do
      expect(next_step(create(:job, user: user, stage: "applied"))).to eq("awaiting_response")
      expect(next_step(create(:job, user: user, stage: "interviewing"))).to eq("practice_interview")
      expect(next_step(create(:job, user: user, stage: "offer"))).to eq("none")
      expect(next_step(create(:job, user: user, stage: "rejected"))).to eq("none")
    end

    it "still shows running AI work on an applied job" do
      job.update!(stage: "applied")
      gap_task("queued")
      expect(next_step).to eq("comparison_running")
    end
  end

  describe "ownership" do
    it "ignores another user's tasks, resumes, and jobs" do
      other_user = create(:user)
      gap_task("queued", owner: other_user)
      create(:resume, user: other_user, job: job)
      other_job = create(:job, user: other_user)

      entries = described_class.call(user: user).value

      expect(entries.map { _1[:job] }).to eq([ job ])
      expect(entries.first[:next_step]).to eq("compare")
      expect(entries.map { _1[:job] }).not_to include(other_job)
    end
  end

  it "lists jobs newest first" do
    older = create(:job, user: user, created_at: 2.days.ago)
    newer = create(:job, user: user, created_at: 1.day.ago)

    expect(described_class.call(user: user).value.map { _1[:job] }).to eq([ newer, older ])
  end

  it "uses the same number of queries for one job or many" do
    count_queries = lambda do
      queries = 0
      counter = ->(*, payload) { queries += 1 unless payload[:name] == "SCHEMA" || payload[:cached] }
      ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { described_class.call(user: user) }
      queries
    end
    add_job = lambda do |stage|
      added = create(:job, user: user, stage: stage)
      create(:ai_task, user: user, subject: added, task_type: "analyze_gaps", status: "completed")
      create(:ai_task, user: user, subject: added, task_type: "tailor_resume", status: "completed")
      create(:resume, user: user, job: added)
    end

    add_job.call("unapplied")
    one_job_queries = count_queries.call
    5.times { |index| add_job.call(Job::STAGES[index]) }

    expect(count_queries.call).to eq(one_job_queries)
    expect(one_job_queries).to eq(3)
  end
end

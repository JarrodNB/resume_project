# Checks which AI work counts as running on Home, and that labels and links stay owner-safe.
require "rails_helper"

RSpec.describe AiTasks::ListRunningTasksService do
  let(:user) { create(:user) }

  def running = described_class.call(user: user).value

  it "lists queued general work of every kind, newest first, with job titles and links" do
    job = create(:job, user: user, title: "Data Analyst")
    import = create(:ai_task, user: user, task_type: "parse_resume", created_at: 2.minutes.ago)
    draft = create(:ai_task, user: user, task_type: "tailor_resume", subject: job, created_at: 1.minute.ago)

    expect(running.map { |task| task.slice(:id, :label, :destination) }).to eq([
      { id: draft.id, label: "Resume draft: Data Analyst", destination: "/jobs/#{job.id}/resume" },
      { id: import.id, label: "Resume import", destination: "/library/import/#{import.id}" }
    ])
  end

  it "leaves out finished work, work waiting on the user, live interview work and other users' work" do
    create(:ai_task, user: user, status: "completed")
    create(:ai_task, user: user, status: "failed")
    create(:ai_task, user: user, task_type: "improve_library_entry", status: "needs_user_input")
    create(:ai_task, user: user, task_type: "interview_turn")
    create(:ai_task, task_type: "parse_resume")

    expect(running).to eq([])
  end

  it "does not show another user's job title" do
    task = create(:ai_task, user: user, task_type: "analyze_gaps", subject: create(:job, title: "Someone else's job"))

    expect(running.first).to include(id: task.id, label: "Gap analysis", destination: "/jobs")
  end

  it "links a running job import to its progress page" do
    task = create(:ai_task, user: user, task_type: "scrape_job")

    expect(running.first[:destination]).to eq("/jobs/new/#{task.id}")
  end
end

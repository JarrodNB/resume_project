# Description: Tailoring mutations and Job.latestTailoring, including ownership.
require "rails_helper"

RSpec.describe "Resume tailoring mutations" do
  let(:user) { create(:user, name: "Ada Lovelace") }
  let(:job) { create(:job, user: user) }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before do
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    allow(ApiSchema.subscriptions).to receive(:trigger)
    create(:ai_task, user: user, subject: job, task_type: "analyze_gaps", status: "completed", result: { "gap_analysis" => { "summary" => "Close." } })
  end

  it "startResumeTailoring queues a task for the user's job" do
    query = <<~GQL
      mutation($jobId: ID!) {
        startResumeTailoring(input: { jobId: $jobId }) { aiTask { taskType status } errors }
      }
    GQL

    result = execute_graphql(query, user: user, variables: { jobId: job.id })

    expect(result.dig("data", "startResumeTailoring")).to eq(
      "aiTask" => { "taskType" => "TAILOR_RESUME", "status" => "QUEUED" },
      "errors" => []
    )
  end

  it "accepts a two-page target only for the signed-in user's eligible library" do
    query = <<~GQL
      mutation($jobId: ID!) {
        startResumeTailoring(input: { jobId: $jobId, targetPages: 2 }) { aiTask { input } errors }
      }
    GQL
    create(:user, summary: "Led " * 700)
    rejected = execute_graphql(query, user: user, variables: { jobId: job.id })
    expect(rejected.dig("data", "startResumeTailoring", "errors").join).to include("700")
    expect(AiTask.tailor_resume).to be_empty
    user.update!(summary: "Led " * 700)
    accepted = execute_graphql(query, user: user, variables: { jobId: job.id })
    expect(accepted.dig("data", "startResumeTailoring", "errors")).to eq([])
    expect(accepted.dig("data", "startResumeTailoring", "aiTask", "input", "target_pages")).to eq(2)
  end

  it "startResumeTailoring can't start another user's job" do
    query = <<~GQL
      mutation($jobId: ID!) { startResumeTailoring(input: { jobId: $jobId }) { aiTask { id } errors } }
    GQL

    result = execute_graphql(query, user: user, variables: { jobId: create(:job).id })

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(AiTask.tailor_resume).to be_empty
  end

  it "rejects obsolete section approval operations without changing the task" do
    other = create(:ai_task, task_type: "tailor_resume", status: "needs_user_input")
    query = <<~GQL
      mutation($id: ID!) {
        submitTailoredSection(input: { aiTaskId: $id, sectionType: "summary", action: "approve", content: {} }) {
          aiTask { id } errors
        }
      }
    GQL

    result = execute_graphql(query, user: user, variables: { id: other.id })

    expect(result["errors"].first["message"]).to include("submitTailoredSection", "doesn't exist")
    expect(other.reload).to be_needs_user_input
  end

  it "saveTailoredResume can't save another user's task" do
    other = create(:ai_task, task_type: "tailor_resume", status: "completed", result: { "sections" => [] })
    query = <<~GQL
      mutation($id: ID!) { saveTailoredResume(input: { aiTaskId: $id }) { resume { id } errors } }
    GQL

    result = execute_graphql(query, user: user, variables: { id: other.id })

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(Resume.count).to eq(0)
  end

  it "saveTailoredResume rejects an obsolete section result" do
    task = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed",
                  result: { "sections" => [ { "section_type" => "summary", "content" => { "text" => "Original" } } ] })
    query = <<~GQL
      mutation($id: ID!, $markdown: String!) {
        saveTailoredResume(input: { aiTaskId: $id, markdown: $markdown }) { resume { id } errors }
      }
    GQL

    result = execute_graphql(query, user: user, variables: { id: task.id, markdown: "# New" })

    expect(result.dig("data", "saveTailoredResume", "errors")).to eq([ ResumeTailoring::SaveTailoredResumeService::NOT_READY_MESSAGE ])
    expect(Resume.count).to eq(0)
    expect(task.reload).not_to be_accepted
  end

  it "updateResume replaces Markdown" do
    resume = create(:resume, user: user, job: job)
    query = <<~GQL
      mutation($id: ID!, $markdown: String!) {
        updateResume(input: { id: $id, markdown: $markdown }) {
          resume { markdown targetPages }
          errors
        }
      }
    GQL

    result = execute_graphql(query, user: user, variables: { id: resume.id, markdown: "# Backend engineer" })

    payload = result.dig("data", "updateResume")
    expect(payload["errors"]).to eq([])
    expect(payload["resume"]).to eq("markdown" => "# Backend engineer", "targetPages" => 1)
  end

  it "updateResume can't edit another user's resume" do
    resume = create(:resume)
    query = <<~GQL
      mutation($id: ID!, $markdown: String!) {
        updateResume(input: { id: $id, markdown: $markdown }) { resume { id } errors }
      }
    GQL

    result = execute_graphql(query, user: user, variables: { id: resume.id, markdown: "# Mine" })

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(resume.reload.markdown).to eq("# Ada\n\nBackend engineer.")
  end

  it "latestTailoring returns the job's tailor task" do
    task = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed", result: { "sections" => [], "warnings" => [] })
    query = <<~GQL
      query($id: ID!) { job(id: $id) { latestTailoring { id status } resume { id } } }
    GQL

    result = execute_graphql(query, user: user, variables: { id: job.id })

    expect(result.dig("data", "job", "latestTailoring")).to eq("id" => task.id, "status" => "COMPLETED")
    expect(result.dig("data", "job", "resume")).to be_nil
  end
end

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

  it "startResumeTailoring can't start another user's job" do
    query = <<~GQL
      mutation($jobId: ID!) { startResumeTailoring(input: { jobId: $jobId }) { aiTask { id } errors } }
    GQL

    result = execute_graphql(query, user: user, variables: { jobId: create(:job).id })

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(AiTask.tailor_resume).to be_empty
  end

  it "submitTailoredSection can't edit another user's task" do
    other = create(:ai_task, task_type: "tailor_resume", status: "needs_user_input")
    query = <<~GQL
      mutation($id: ID!) {
        submitTailoredSection(input: { aiTaskId: $id, sectionType: "summary", action: "approve", content: {} }) {
          aiTask { id } errors
        }
      }
    GQL

    result = execute_graphql(query, user: user, variables: { id: other.id })

    expect(result["errors"].first["message"]).to eq("Record not found")
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

  it "updateResume replaces section content" do
    resume = create(:resume, user: user, job: job)
    section = create(:resume_section, resume: resume, content: { "text" => "Old." })
    query = <<~GQL
      mutation($id: ID!, $sections: JSON!) {
        updateResume(input: { id: $id, sections: $sections }) {
          resume { sections { id content } }
          errors
        }
      }
    GQL

    result = execute_graphql(query, user: user, variables: {
      id: resume.id,
      sections: [ { "id" => section.id, "content" => { "text" => "Backend engineer." } } ]
    })

    payload = result.dig("data", "updateResume")
    expect(payload["errors"]).to eq([])
    expect(payload.dig("resume", "sections", 0, "content")).to eq("text" => "Backend engineer.")
  end

  it "updateResume can't edit another user's resume" do
    resume = create(:resume)
    section = create(:resume_section, resume: resume, content: { "text" => "Theirs." })
    query = <<~GQL
      mutation($id: ID!, $sections: JSON!) {
        updateResume(input: { id: $id, sections: $sections }) { resume { id } errors }
      }
    GQL

    result = execute_graphql(query, user: user, variables: {
      id: resume.id,
      sections: [ { "id" => section.id, "content" => { "text" => "Mine." } } ]
    })

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(section.reload.content).to eq("text" => "Theirs.")
  end

  it "latestTailoring returns the job's tailor task" do
    task = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "needs_user_input")
    query = <<~GQL
      query($id: ID!) { job(id: $id) { latestTailoring { id status } resume { id } } }
    GQL

    result = execute_graphql(query, user: user, variables: { id: job.id })

    expect(result.dig("data", "job", "latestTailoring")).to eq("id" => task.id, "status" => "NEEDS_USER_INPUT")
    expect(result.dig("data", "job", "resume")).to be_nil
  end
end

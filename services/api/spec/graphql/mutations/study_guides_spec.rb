# Exercises owned study-guide generation and saved result retrieval through GraphQL.
require "rails_helper"

RSpec.describe "Study guide generation" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, description: "Maintain inventory records and reconcile stock counts.") }
  let(:mutation) { 'mutation($id: ID!) { generateStudyGuide(input: {jobId: $id}) { aiTask { id status } errors } }' }

  before { allow(Shoryuken::Client).to receive_message_chain(:queues, :send_message) }

  it "queues the exact description without requiring a career library" do
    data = execute_graphql(mutation, user: user, variables: { id: job.id })
    expect(data.dig("data", "generateStudyGuide", "errors")).to eq([])
    task = user.ai_tasks.last
    expect(task.task_type).to eq("generate_study_guide")
    expect(task.subject).to eq(job)
    expect(task.input).to eq("job_id" => job.id, "description" => job.description)
  end
  it "rejects another user's job" do
    response = execute_graphql(mutation, user: user, variables: { id: create(:job).id })
    expect(response["errors"].first["message"]).to eq("Record not found")
    expect(user.ai_tasks).to be_empty
  end

  it "rejects blank descriptions and overlapping generation" do
    job.update!(description: "  ")
    response = execute_graphql(mutation, user: user, variables: { id: job.id })
    expect(response.dig("data", "generateStudyGuide", "errors")).to include(/Add a job description/)
    job.update!(description: "Reconcile inventory.")
    2.times { execute_graphql(mutation, user: user, variables: { id: job.id }) }
    expect(user.ai_tasks.count).to eq(1)
  end

  it "keeps the successful guide readable after a newer attempt fails" do
    saved = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed", result: { study_guide: { title: "Inventory" } })
    failed = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "failed", created_at: 1.minute.from_now)
    response = execute_graphql('query($id: ID!) { job(id: $id) { latestStudyGuide { id result } latestStudyGuideTask { id status } } }', user: user, variables: { id: job.id })
    expect(response.dig("data", "job", "latestStudyGuide", "id")).to eq(saved.id)
    expect(response.dig("data", "job", "latestStudyGuideTask", "id")).to eq(failed.id)
  end

  it "respects AI allowances without creating or publishing work" do
    allow(AiUsage::CheckAiTaskAllowanceService).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "Budget reached" ]))
    response = execute_graphql(mutation, user: user, variables: { id: job.id })
    expect(response.dig("data", "generateStudyGuide", "errors")).to eq([ "Budget reached" ])
    expect(user.ai_tasks).to be_empty
  end

  it "hides a deleted job's guide source and result from direct task reads" do
    task = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed", input: { description: job.description }, result: { study_guide: { title: "private" } })
    Records::DestroyRecordService.call(record: job)
    response = execute_graphql('query($id: ID!) { aiTask(id: $id) { input result } }', user: user, variables: { id: task.id })
    expect(response.dig("data", "aiTask")).to eq("input" => {}, "result" => nil)
    response = execute_graphql('query($id: ID!) { aiTask(id: $id) { result } }', user: create(:user), variables: { id: task.id })
    expect(response["errors"].first["message"]).to eq("Record not found")
  end

end

# Description: analyzeJobGaps mutation and Job.latestGapAnalysis, including ownership.
require "rails_helper"

RSpec.describe "Gap analysis mutation" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }

  before do
    queue = instance_double(Shoryuken::Queue, send_message: nil)
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    create(:skill, user: user)
  end

  let(:mutation) do
    <<~GQL
      mutation($jobId: ID!) {
        analyzeJobGaps(input: { jobId: $jobId }) { aiTask { taskType status job { id } } errors }
      }
    GQL
  end

  it "analyzeJobGaps returns the queued task about the job" do
    result = execute_graphql(mutation, user: user, variables: { jobId: job.id })

    expect(result.dig("data", "analyzeJobGaps")).to eq(
      "aiTask" => { "taskType" => "ANALYZE_GAPS", "status" => "QUEUED", "job" => { "id" => job.id } },
      "errors" => []
    )
  end

  it "analyzeJobGaps returns the service's error" do
    user.skills.destroy_all

    result = execute_graphql(mutation, user: user, variables: { jobId: job.id })

    expect(result.dig("data", "analyzeJobGaps")).to eq(
      "aiTask" => nil, "errors" => [ GapAnalysis::StartGapAnalysisService::EMPTY_LIBRARY_MESSAGE ]
    )
  end

  it "analyzeJobGaps can't analyze another user's job" do
    result = execute_graphql(mutation, user: user, variables: { jobId: create(:job).id })

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(AiTask.count).to eq(0)
  end

  it "latestGapAnalysis returns the newest analysis of the job" do
    travel_to(1.day.ago) { create(:ai_task, user: user, subject: job, status: "completed") }
    newest = create(:ai_task, user: user, subject: job, status: "completed", result: { "gap_analysis" => { "summary" => "Good" } })
    create(:ai_task, user: user, task_type: "scrape_job", subject: job, status: "completed")
    query = "query($id: ID!) { job(id: $id) { latestGapAnalysis { id status result } } }"

    result = execute_graphql(query, user: user, variables: { id: job.id })

    expect(result.dig("data", "job", "latestGapAnalysis")).to eq(
      "id" => newest.id, "status" => "COMPLETED", "result" => { "gap_analysis" => { "summary" => "Good" } }
    )
  end

  it "latestGapAnalysis is null before the first analysis" do
    result = execute_graphql("query($id: ID!) { job(id: $id) { latestGapAnalysis { id } } }", user: user, variables: { id: job.id })

    expect(result.dig("data", "job", "latestGapAnalysis")).to be_nil
  end
end

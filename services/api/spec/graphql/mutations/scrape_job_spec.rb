# Description: scrapeJob mutation and the job field on AI tasks, including ownership.
require "rails_helper"

RSpec.describe "Job scraping mutation" do
  let(:user) { create(:user) }

  it "scrapeJob returns the queued task" do
    queue = instance_double(Shoryuken::Queue, send_message: nil)
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)

    result = execute_graphql(<<~GQL, user: user)
      mutation {
        scrapeJob(input: { url: "https://www.linkedin.com/jobs/view/1" }) {
          aiTask { taskType status job { id } }
          errors
        }
      }
    GQL

    expect(result.dig("data", "scrapeJob")).to eq(
      "aiTask" => { "taskType" => "SCRAPE_JOB", "status" => "QUEUED", "job" => nil }, "errors" => []
    )
  end

  it "scrapeJob returns an error for an unsupported site" do
    result = execute_graphql(<<~GQL, user: user)
      mutation { scrapeJob(input: { url: "https://example.com/jobs/1" }) { aiTask { id } errors } }
    GQL

    expect(result.dig("data", "scrapeJob")).to eq(
      "aiTask" => nil, "errors" => [ Jobs::StartJobScrapingService::UNSUPPORTED_URL_MESSAGE ]
    )
  end

  it "a scrape_job task exposes the created job to its owner only" do
    job = create(:job, user: user)
    ai_task = create(:ai_task, user: user, task_type: "scrape_job", status: "completed", subject: job)
    other_task = create(:ai_task, task_type: "scrape_job", status: "completed", subject: create(:job))
    query = "query($id: ID!) { aiTask(id: $id) { job { id title } } }"

    result = execute_graphql(query, user: user, variables: { id: ai_task.id })
    other_result = execute_graphql(query, user: user, variables: { id: other_task.id })

    expect(result.dig("data", "aiTask", "job")).to eq("id" => job.id, "title" => job.title)
    expect(other_result["errors"].first["message"]).to eq("Record not found")
  end
end

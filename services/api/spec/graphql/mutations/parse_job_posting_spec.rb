# Description: parseJobPosting mutation.
require "rails_helper"

RSpec.describe "Job posting parse mutation" do
  let(:user) { create(:user) }

  it "parseJobPosting returns the queued task" do
    queue = instance_double(Shoryuken::Queue, send_message: nil)
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)

    result = execute_graphql(<<~GQL, user: user)
      mutation {
        parseJobPosting(input: { text: "AI Engineer at Acme" }) {
          aiTask { taskType status job { id } }
          errors
        }
      }
    GQL

    expect(result.dig("data", "parseJobPosting")).to eq(
      "aiTask" => { "taskType" => "PARSE_JOB_POSTING", "status" => "QUEUED", "job" => nil }, "errors" => []
    )
  end

  it "parseJobPosting returns an error for a blank paste" do
    result = execute_graphql(<<~GQL, user: user)
      mutation { parseJobPosting(input: { text: "  " }) { aiTask { id } errors } }
    GQL

    expect(result.dig("data", "parseJobPosting")).to eq(
      "aiTask" => nil, "errors" => [ Jobs::StartJobPostingParseService::BLANK_MESSAGE ]
    )
  end
end

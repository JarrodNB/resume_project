# Description: The runningAiTasks query returns the signed-in user's AI work still in progress.
require "rails_helper"

RSpec.describe "runningAiTasks query" do
  let(:user) { create(:user) }
  let(:query) { "{ runningAiTasks { id taskType label destination startedAt } }" }

  it "returns the user's running work" do
    task = create(:ai_task, user: user, task_type: "generate_study_guide", subject: create(:job, user: user, title: "QA Lead"))

    result = execute_graphql(query, user: user)

    expect(result["errors"]).to be_nil
    expect(result.dig("data", "runningAiTasks", 0)).to include("id" => task.id, "taskType" => "GENERATE_STUDY_GUIDE",
      "label" => "Study guide: QA Lead", "destination" => "/jobs/#{task.subject_id}/study")
  end

  it "requires a signed-in user" do
    expect(execute_graphql(query, user: nil)["errors"].first["message"]).to eq("Authentication required")
  end
end

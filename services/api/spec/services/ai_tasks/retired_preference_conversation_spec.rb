# Retired preference conversations keep their history, but late output cannot change a profile.
require "rails_helper"

RSpec.describe "Retired preference conversation results" do
  it "fails a late completion without replacing the manual preference draft and keeps duplicate delivery safe" do
    user = create(:user)
    profile = user.create_job_preference_profile!(version: 0)
    task = user.ai_tasks.create!(task_type: "elicit_job_preferences", input: { profile_version: 0, message: "Remote", history: [ { private: "history" } ] })
    message = { "ai_task_id" => task.id, "status" => "completed",
      "message_history" => [ { "kind" => "response", "parts" => [ { "part_kind" => "text", "content" => "Review" } ] } ],
      "result" => { "reply" => "Review", "criteria" => [ { "text" => "Fully remote", "priority" => "must_have" } ] } }
    2.times { expect(AiTasks::ApplyAiResultService.call(message: message)).to be_success }
    expect(profile.reload).to have_attributes(version: 0, draft_criteria: [], confirmed_criteria: [])
    expect(task.reload).to have_attributes(status: "failed", result: nil)
    expect(task.error_message).to include("no longer available")
    expect(task.input).to include("history" => [ { "private" => "history" } ])
    history = execute_graphql("query($id: ID!) { aiTask(id: $id) { taskType input } }", user: user, variables: { id: task.id })
    expect(history.dig("data", "aiTask", "taskType")).to eq("ELICIT_JOB_PREFERENCES")
    expect(history.dig("data", "aiTask", "input")).not_to have_key("history")
  end
end

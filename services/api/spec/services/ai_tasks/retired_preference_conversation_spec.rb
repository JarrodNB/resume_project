# Removed task types retain usage history, but late output cannot restore the feature.
require "rails_helper"

RSpec.describe "Retired job preference results" do
  %w[elicit_job_preferences check_job_preferences].each do |task_type|
    it "fails a late #{task_type} completion and keeps duplicate delivery safe" do
      user = create(:user)
      task = user.ai_tasks.create!(task_type: task_type, input: { profile_version: 0, message: "Remote", history: [ { private: "history" } ] })
      message = { "ai_task_id" => task.id, "status" => "completed",
        "message_history" => [ { "kind" => "response", "parts" => [ { "part_kind" => "text", "content" => "Review" } ] } ],
        "result" => { "reply" => "Review", "criteria" => [ { "text" => "Fully remote", "priority" => "must_have" } ] } }
      2.times { expect(AiTasks::ApplyAiResultService.call(message: message)).to be_success }
      expect(task.reload).to have_attributes(status: "failed", result: nil)
      expect(task.error_message).to include("no longer available")
      expect(task.input).to include("history" => [ { "private" => "history" } ])
      history = execute_graphql("query($id: ID!) { aiTask(id: $id) { taskType input } }", user: user, variables: { id: task.id })
      expect(history.dig("data", "aiTask", "taskType")).to eq(task_type.upcase)
      expect(history.dig("data", "aiTask", "input")).not_to have_key("history")
    end
  end
end

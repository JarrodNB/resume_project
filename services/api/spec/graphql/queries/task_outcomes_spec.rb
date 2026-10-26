# Checks recovery through the public owner-scoped task outcome query.
require "rails_helper"

RSpec.describe "Task outcome recovery" do
  let(:user) { create(:user) }
  let(:query) { <<~GRAPHQL }
    query($after: String!, $through: String!, $limit: Int!) {
      taskOutcomes(after: $after, through: $through, limit: $limit) {
        cursor hasMore outcomes { id taskId status title destination completedAt }
      }
    }
  GRAPHQL

  def finish(owner, status = "completed")
    task = create(:ai_task, user: owner)
    AiTasks::UpdateTaskService.call(task: task, attributes: { status: status, completed_at: Time.current })
    task.ai_task_outcomes.sole
  end

  it "recovers ordered owner outcomes in bounded pages without leaking another owner's work" do
    first = finish(user, "failed")
    foreign = finish(create(:user))
    last = finish(user)
    later = finish(user)
    result = execute_graphql(query, user: user, variables: { after: "0", through: last.sequence.to_s, limit: 1 })
    expect(result["errors"]).to be_nil
    page = result.dig("data", "taskOutcomes")
    expect(page["outcomes"].pluck("id")).to eq([first.id])
    expect(page["hasMore"]).to be(true)
    result = execute_graphql(query, user: user, variables: { after: page["cursor"], through: last.sequence.to_s, limit: 1 })
    page = result.dig("data", "taskOutcomes")
    expect(page["outcomes"].pluck("id")).to eq([last.id])
    expect(page["cursor"]).to eq(last.sequence.to_s)
    expect(page["hasMore"]).to be(false)
    expect(page["outcomes"].pluck("id")).not_to include(foreign.id, later.id)
  end
  it "rejects unauthenticated callers and malformed, reversed or unbounded ranges" do
    result = execute_graphql(query, user: nil, variables: { after: "0", through: "0", limit: 1 })
    expect(result["errors"].first["message"]).to eq("Authentication required")
    result = execute_graphql('{ taskOutcomes(after: "0", through: "0", limit: null) { cursor } }', user: user)
    expect(result["errors"].first["message"]).to eq("Invalid task outcome range")
    [ { after: "-1", through: "0", limit: 1 }, { after: "2", through: "1", limit: 1 },
      { after: "0", through: "9223372036854775808", limit: 1 },
      { after: "0", through: "0", limit: 101 } ].each do |variables|
      result = execute_graphql(query, user: user, variables: variables)
      expect(result["errors"].first["message"]).to eq("Invalid task outcome range")
    end
  end

  it "resets a checkpoint beyond the current database without replaying history" do
    outcome = finish(user)
    result = execute_graphql(query, user: user, variables: { after: "999999999", through: "999999999", limit: 1 })
    page = result.dig("data", "taskOutcomes")
    expect(page).to include("cursor" => outcome.sequence.to_s, "outcomes" => [], "hasMore" => false)
  end

end

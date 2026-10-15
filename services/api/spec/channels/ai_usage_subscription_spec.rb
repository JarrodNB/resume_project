# Description: Monthly usage subscriptions expose current totals only to their owner.
# Index:
#   - examples: initial state and cross-user subscription rejection
require "rails_helper"

RSpec.describe GraphqlChannel, type: :channel do
  it "sends the owner's known spend and incomplete accounting" do
    user = create(:user)
    task = create(:ai_task, user: user, cost_microdollars: 35)
    AiUsageAttempt.create!(ai_task: task, attempt_id: SecureRandom.uuid, incomplete: true)
    stub_connection current_user: user
    subscribe
    perform :execute, "query" => "subscription { aiUsageUpdated(userId: \"#{user.id}\") { spentThisMonthUsd incompleteAttempts } }"
    expect(transmissions.last.dig("result", "data", "aiUsageUpdated"))
      .to include("spentThisMonthUsd" => 0.000035, "incompleteAttempts" => 1)
    expect(transmissions.last["more"]).to be(true)
  end

  it "rejects another user's usage subscription" do
    stub_connection current_user: create(:user)
    subscribe
    perform :execute, "query" => "subscription { aiUsageUpdated(userId: \"#{create(:user).id}\") { incompleteAttempts } }"
    expect(transmissions.last.dig("result", "errors", 0, "message")).to eq("Record not found")
  end
end

# Description: Verifies user-scoped AI cost totals and UTC calendar-month accounting.
# Index:
#   - AI cost methods: empty totals, ownership, dollar conversion, and month boundaries
require "rails_helper"

RSpec.describe User, type: :model do
  it "returns zero costs when the user has no AI tasks" do
    user = create(:user)

    expect(user.total_ai_cost_usd).to eq(0.0)
    expect(user.monthly_ai_cost_usd).to eq(0.0)
  end

  it "sums only the user's tasks and uses the UTC month boundary for monthly cost" do
    travel_to Time.utc(2026, 10, 13, 12) do
      user = create(:user)
      create(:ai_task, user: user, cost_microdollars: 1_250_000, created_at: Time.utc(2026, 9, 30, 23, 59, 59))
      create(:ai_task, user: user, cost_microdollars: 250_001, created_at: Time.utc(2026, 10, 1))
      create(:ai_task, user: user, cost_microdollars: 500_000, status: "failed")
      create(:ai_task, cost_microdollars: 9_000_000)
      user.embedding_usages.create!(model: "text-embedding-3-small", input_tokens: 100, cost_microdollars: 2)
      user.embedding_usages.create!(model: "text-embedding-3-small", input_tokens: 100, cost_microdollars: 2,
                                   created_at: Time.utc(2026, 9, 30))
      create(:user).embedding_usages.create!(model: "text-embedding-3-small", input_tokens: 100, cost_microdollars: 2)

      expect(user.total_ai_cost_usd).to eq(2.000005)
      expect(user.monthly_ai_cost_usd).to eq(0.750003)
    end
  end
end

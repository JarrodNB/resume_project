# Description: Summing a user's AI spend for the current calendar month.
require "rails_helper"

RSpec.describe AiUsage::SummarizeMonthlyAiUsageService do
  let(:user) { create(:user) }

  it "flags incomplete accounting without blocking work below the known-spend budget" do
    task = create(:ai_task, user: user, cost_microdollars: 35)
    AiUsageAttempt.create!(ai_task: task, attempt_id: SecureRandom.uuid, incomplete: true)
    other = create(:ai_task)
    AiUsageAttempt.create!(ai_task: other, attempt_id: SecureRandom.uuid, incomplete: true)
    usage = described_class.call(user: user).value
    expect(usage.incomplete_attempts).to eq(1)
    expect(usage.spent_microdollars).to eq(35)
    expect(usage).not_to be_exhausted
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).to be_success
  end

  it "sums this month's task costs, with the default budget and next reset" do
    travel_to Time.utc(2026, 10, 15) do
      create(:ai_task, user: user, cost_microdollars: 1_500)
      create(:ai_task, user: user, cost_microdollars: 2_500)
      create(:ai_task, user: user, cost_microdollars: 9_999, created_at: Time.utc(2026, 9, 30))

      usage = described_class.call(user: user).value

      expect(usage.spent_microdollars).to eq(4_000)
      expect(usage.budget_microdollars).to eq(DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS)
      expect(usage.resets_at).to eq(Time.utc(2026, 11, 1))
      expect(usage).not_to be_exhausted
    end
  end
end

RSpec.describe "Separate spoken interview spend" do
  it "keeps spoken interview bills and unknown markers out of the general usage summary" do
    user = create(:user)
    %w[interview_preparation interview_turn interview_speech].each do |kind|
      task = create(:ai_task, user: user, task_type: kind, cost_microdollars: 100)
      AiUsageAttempt.create!(ai_task: task, attempt_id: SecureRandom.uuid, incomplete: true)
    end
    create(:ai_task, user: user, task_type: "review_interview_answer", cost_microdollars: 25)
    usage = AiUsage::SummarizeMonthlyAiUsageService.call(user: user).value
    expect(usage.spent_microdollars).to eq(25)
    expect(usage.incomplete_attempts).to eq(0)
    expect(user.ai_tasks.sum(:cost_microdollars)).to eq(325)
    expect(AiUsageAttempt.where(ai_task_id: user.ai_tasks.select(:id), incomplete: true).count).to eq(3)
  end
end

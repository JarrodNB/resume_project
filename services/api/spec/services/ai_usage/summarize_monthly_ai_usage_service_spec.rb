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
      expect(usage.budget_microdollars).to eq(DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS + DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS)
      expect(usage.resets_at).to eq(Time.utc(2026, 11, 1))
      expect(usage).not_to be_exhausted
    end
  end
end

RSpec.describe "Combined AI spend with independent allowances" do
  it "combines every spoken stage and its unknown markers while retaining separate allowance summaries" do
    travel_to Time.utc(2026, 10, 15) do
      user = create(:user, monthly_ai_budget_microdollars: 50)
      stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 1_000)
      %w[interview_preparation interview_turn interview_speech interview_transcription interview_clarification interview_references].each do |kind|
        task = create(:ai_task, user: user, task_type: kind, cost_microdollars: 100, status: "failed")
        AiUsageAttempt.create!(ai_task: task, attempt_id: SecureRandom.uuid, incomplete: true)
      end
      create(:ai_task, user: user, task_type: "review_interview_answer", cost_microdollars: 25, status: "completed")
      create(:ai_task, user: user, task_type: "interview_turn", cost_microdollars: 999, created_at: Time.utc(2026, 9, 30))
      other = create(:ai_task, task_type: "interview_turn", cost_microdollars: 999)
      AiUsageAttempt.create!(ai_task: other, attempt_id: SecureRandom.uuid, incomplete: true)

      combined = AiUsage::SummarizeMonthlyAiUsageService.call(user: user).value
      general = AiUsage::SummarizeMonthlyAiUsageService.call(user: user, scope: :general).value
      interview = AiUsage::SummarizeMonthlyAiUsageService.call(user: user, scope: :interview).value

      expect(combined).to have_attributes(spent_microdollars: 625, budget_microdollars: 1_050, incomplete_attempts: 6,
        resets_at: Time.utc(2026, 11, 1))
      expect(general).to have_attributes(spent_microdollars: 25, budget_microdollars: 50, incomplete_attempts: 0)
      expect(interview).to have_attributes(spent_microdollars: 600, budget_microdollars: 1_000, incomplete_attempts: 6)
      expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).to be_success
    end
  end
end

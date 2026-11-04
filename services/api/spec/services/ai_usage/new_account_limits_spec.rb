# Recently verified accounts get lower AI limits for a week; overrides and older accounts don't.
require "rails_helper"

RSpec.describe AiUsage::NewAccountLimits do
  let(:new_user) { create(:user, :new_account) }
  let(:allowance) { AiUsage::CheckAiTaskAllowanceService }
  let(:usage) { AiUsage::SummarizeMonthlyAiUsageService }

  def finished_task(user, cost)
    create(:ai_task, :completed_resume_parse, user:, cost_microdollars: cost)
  end

  it "stops a new account at the lower monthly budget, while an established one continues" do
    established = create(:user)
    [ new_user, established ].each { |user| finished_task(user, NEW_ACCOUNT_MONTHLY_AI_BUDGET_MICRODOLLARS) }

    expect(allowance.call(user: new_user).errors.first).to include("usage limit")
    expect(allowance.call(user: established)).to be_success
  end

  it "lowers the interview budget too" do
    expect(usage.call(user: new_user, scope: :interview).value.budget_microdollars).to eq(NEW_ACCOUNT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS)
    expect(usage.call(user: create(:user), scope: :interview).value.budget_microdollars).to eq(DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS)
  end

  it "stops a new account at the lower hourly task limit" do
    stub_const("DEFAULT_AI_TASKS_PER_HOUR", 30)
    stub_const("NEW_ACCOUNT_AI_TASKS_PER_HOUR", 2)
    2.times { finished_task(new_user, 0) }
    expect(allowance.call(user: new_user).errors.first).to include("too many")
  end

  it "lets per-user overrides win" do
    new_user.update!(monthly_ai_budget_microdollars: 50_000_000, ai_tasks_per_hour_limit: 99)
    finished_task(new_user, NEW_ACCOUNT_MONTHLY_AI_BUDGET_MICRODOLLARS)
    expect(allowance.call(user: new_user)).to be_success
  end

  it "ends after a week and tells the person when the limit lifts" do
    travel_to Time.utc(2026, 11, 4) do
      user = create(:user, :new_account)
      finished_task(user, NEW_ACCOUNT_MONTHLY_AI_BUDGET_MICRODOLLARS)
      expect(allowance.call(user:).errors.first).to include("November 11")

      travel 7.days + 1.minute
      expect(allowance.call(user:)).to be_success
    end
  end

  it "never raises a limit set below the new-account value" do
    stub_const("DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS", 1)
    expect(described_class.general_monthly_budget(new_user)).to eq(1)
  end
end

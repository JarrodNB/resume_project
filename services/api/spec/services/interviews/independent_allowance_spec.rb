# Proves spoken practice and ordinary AI features cannot consume one another's allowance.
# Durable task/provider accounting stays shared; only admission and usage views are separated.
require "rails_helper"

RSpec.describe "Independent spoken interview allowances" do
  let(:user) { create(:user, summary: "Maintain laboratory instruments") }

  it "prepares and claims an interview even when every general AI limit is exhausted" do
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 1)
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 1)
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    user.update!(monthly_ai_budget_microdollars: 1, ai_tasks_per_hour_limit: 1, max_in_flight_ai_tasks: 1)
    create(:ai_task, user: user, cost_microdollars: 1)
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).not_to be_success
    result = Interviews::StartPreparationService.call(user: user)
    expect(result).to be_success
    operation = result.value.operations.preparation.first
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
  end

  %w[monthly hourly concurrent].each do |limit|
    it "does not consume the general #{limit} allowance with spoken interview work" do
      user.update!(monthly_ai_budget_microdollars: 100, ai_tasks_per_hour_limit: limit == "hourly" ? 1 : 100,
        max_in_flight_ai_tasks: limit == "concurrent" ? 1 : 100)
      %w[interview_preparation interview_turn interview_speech].each do |kind|
        create(:ai_task, user: user, task_type: kind, cost_microdollars: limit == "monthly" ? 100 : 0,
          status: limit == "concurrent" ? "queued" : "completed")
      end
      expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).to be_success
    end
  end

  it "enforces only the interview monthly budget and keeps its unknown markers separate" do
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 25)
    user.update!(monthly_ai_budget_microdollars: 0)
    create(:ai_task, user: user, cost_microdollars: 500)
    task = create(:ai_task, user: user, task_type: "interview_turn", cost_microdollars: 25, status: "completed")
    AiUsageAttempt.create!(ai_task: task, attempt_id: SecureRandom.uuid, incomplete: true)
    usage = AiUsage::SummarizeMonthlyAiUsageService.call(user: user, interview: true).value
    expect(usage).to have_attributes(spent_microdollars: 25, budget_microdollars: 25, incomplete_attempts: 1)
    expect(Interviews::StartPreparationService.call(user: user).errors.join).to include("month's interview usage")
  end

  it "counts completed or abandoned session starts toward its own hourly limit" do
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 1)
    first = Interviews::StartPreparationService.call(user: user).value
    expect(Interviews::AbandonService.call(interview: first)).to be_success
    result = Interviews::StartPreparationService.call(user: user)
    expect(result.errors.join).to include("too many interview sessions")
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).to be_success
    expect(user.interview_sessions.count).to eq(1)
  end

  it "enforces independent interview concurrency without consuming general concurrency" do
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    create(:ai_task, user: user, task_type: "interview_speech")
    expect(Interviews::StartPreparationService.call(user: user).errors.join).to include("interview operations running")
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).to be_success
  end
end

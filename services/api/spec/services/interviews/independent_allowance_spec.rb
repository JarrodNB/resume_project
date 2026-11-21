# Proves spoken practice and ordinary AI features cannot consume one another's hourly-start and
# in-flight allowances. Spend is the exception: both share one daily spend cap per user.
require "rails_helper"

RSpec.describe "Independent spoken interview allowances" do
  let(:user) { create(:user, summary: "Maintain laboratory instruments") }

  it "prepares and claims an interview even when every general AI start and in-flight limit is exhausted" do
    stub_const("DEFAULT_AI_TASKS_PER_HOUR", 1)
    stub_const("DEFAULT_MAX_IN_FLIGHT_AI_TASKS", 1)
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 1)
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    create(:ai_task, user: user)
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).not_to be_success
    result = Interviews::StartPreparationService.call(user: user)
    expect(result).to be_success
    operation = result.value.operations.preparation.first
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
  end

  it "does not start a spoken interview once the site-wide daily AI limit is reached" do
    stub_const("SITE_DAILY_AI_BUDGET_MICRODOLLARS", 100)
    create(:ai_task, cost_microdollars: 100)
    result = Interviews::StartPreparationService.call(user: user)
    expect(result.errors).to eq([ AiUsage::CheckAiTaskAllowanceService::SITE_LIMIT_MESSAGE ])
  end

  %w[hourly concurrent].each do |limit|
    it "does not consume the general #{limit} allowance with spoken interview work" do
      stub_const("DEFAULT_AI_TASKS_PER_HOUR", limit == "hourly" ? 1 : 100)
      stub_const("DEFAULT_MAX_IN_FLIGHT_AI_TASKS", limit == "concurrent" ? 1 : 100)
      %w[interview_preparation interview_turn interview_speech].each do |kind|
        create(:ai_task, user: user, task_type: kind, status: limit == "concurrent" ? "queued" : "completed")
      end
      expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).to be_success
    end
  end

  it "counts spoken interview spend toward the shared daily cap and keeps its unknown markers" do
    user.update!(daily_ai_spend_cap_microdollars: 25)
    task = create(:ai_task, user: user, task_type: "interview_turn", cost_microdollars: 25, status: "completed")
    AiUsageAttempt.create!(ai_task: task, attempt_id: SecureRandom.uuid, incomplete: true)
    expect(AiUsage::DailySpend.known_microdollars(user)).to eq(25)
    expect(AiUsageAttempt.where(ai_task: user.ai_tasks, incomplete: true).count).to eq(1)
    expect(Interviews::StartPreparationService.call(user: user).errors).to eq([ AiUsage::CheckAiTaskAllowanceService::DAILY_LIMIT_MESSAGE ])
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user).errors).to eq([ AiUsage::CheckAiTaskAllowanceService::DAILY_LIMIT_MESSAGE ])
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

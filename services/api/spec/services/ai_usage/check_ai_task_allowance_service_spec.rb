# Description: The per-user AI limits checked before a task is queued: plan (trial/paid/ended), the
# hidden daily spend cap, the trial-only site-wide cap, hourly task limit and in-flight task limit.
require "rails_helper"

RSpec.describe AiUsage::CheckAiTaskAllowanceService do
  let(:user) { create(:user) }

  # Creates a finished task for the user that cost the given amount.
  def create_finished_task(cost_microdollars: 0, created_at: Time.current)
    create(:ai_task, :completed_resume_parse, user: user, cost_microdollars:, created_at:)
  end

  it "allows a new user" do
    expect(described_class.call(user: user)).to be_success
  end

  describe "plan" do
    it "refuses AI work once the trial has ended, telling the user to subscribe and quoting no amounts" do
      user.update!(trial_ends_at: 1.minute.ago)

      result = described_class.call(user: user)

      expect(result.errors).to eq([ described_class::PLAN_ENDED_MESSAGE ])
      expect(described_class::PLAN_ENDED_MESSAGE).to match(/free trial has ended.*subscribe/i)
      expect(described_class::PLAN_ENDED_MESSAGE).not_to match(/\$|\d/)
    end

    it "marks the refusal with the plan_ended code" do
      user.update!(trial_ends_at: 1.minute.ago)

      expect(described_class.call(user: user).code).to eq(:plan_ended)
    end

    it "gives a refusal for any other reason no plan_ended code" do
      user.update!(trial_ends_at: 1.day.from_now)
      allow(AiUsage::DailySpend).to receive(:known_microdollars).and_return(10**12)

      expect(described_class.call(user: user).code).not_to eq(:plan_ended)
    end

    it "refuses spoken interviews too" do
      user.update!(trial_ends_at: 1.minute.ago)

      expect(described_class.call(user: user, interview: true).errors).to eq([ described_class::PLAN_ENDED_MESSAGE ])
    end

    it "keeps working for a paying subscriber after the trial" do
      user.update!(trial_ends_at: 1.day.ago)
      create(:billing_subscription, user: user)

      expect(described_class.call(user: user.reload)).to be_success
    end

    it "refuses an ended plan even with a cap override" do
      user.update!(trial_ends_at: 1.day.ago, daily_ai_spend_cap_microdollars: 1_000_000)

      result = described_class.call(user: user)

      expect(result).not_to be_success
      expect(result.code).to eq(:plan_ended)
    end

    it "skips the plan check for development-only unmetered interview testing" do
      user.update!(trial_ends_at: 1.day.ago)
      allow(Interviews::LocalTesting).to receive(:unmetered?).and_return(true)

      expect(described_class.call(user: user, interview: true)).to be_success
      expect(described_class.call(user: user)).not_to be_success
    end

    it "recognises a plan-ended refusal so callers can report a distinct failure code" do
      user.update!(trial_ends_at: 1.day.ago)

      expect(described_class.refusal_code(described_class.call(user: user))).to eq("plan_ended")
      create_finished_task(cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS)
      user.update!(trial_ends_at: 1.day.from_now)
      expect(described_class.refusal_code(described_class.call(user: user))).to eq("ai_usage_limit_reached")
    end
  end

  describe "daily spend cap" do
    it "refuses once today's spend reaches the trial cap, with a message that has no amounts" do
      create_finished_task(cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS)

      result = described_class.call(user: user)

      expect(result.errors).to eq([ "You've reached today's usage limit. Try again tomorrow." ])
    end

    it "allows work while spend is just under the cap" do
      create_finished_task(cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS - 1)

      expect(described_class.call(user: user)).to be_success
    end

    it "uses the larger paid cap for a subscriber, against today's spend so far" do
      create(:billing_subscription, user: user)
      create_finished_task(cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS)
      user.reload

      expect(described_class.call(user: user)).to be_success

      create_finished_task(cost_microdollars: PAID_DAILY_AI_SPEND_CAP_MICRODOLLARS)
      expect(described_class.call(user: user).errors).to eq([ described_class::DAILY_LIMIT_MESSAGE ])
    end

    it "ignores yesterday's spend (UTC day)" do
      travel_to Time.utc(2026, 11, 2, 0, 5) do
        create_finished_task(cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS, created_at: Time.utc(2026, 11, 1, 23, 55))

        expect(described_class.call(user: user)).to be_success
      end
    end

    it "uses the user's cap override instead of the plan's cap" do
      user.update!(daily_ai_spend_cap_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS * 2)
      create_finished_task(cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS)

      expect(described_class.call(user: user)).to be_success
    end

    it "doesn't count other users' spend" do
      create(:ai_task, :completed_resume_parse, cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS)

      expect(described_class.call(user: user)).to be_success
    end

    it "shares one cap between general AI and spoken interviews" do
      create(:ai_task, user: user, task_type: "interview_turn", status: "completed", cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS)

      expect(described_class.call(user: user).errors).to eq([ described_class::DAILY_LIMIT_MESSAGE ])
      expect(described_class.call(user: user, interview: true).errors).to eq([ described_class::DAILY_LIMIT_MESSAGE ])
    end

    it "counts background embedding receipts but treats unknown costs as zero" do
      AiEmbeddingRequest.create!(user: user, model: "text-embedding-3-small", purpose: "career_library", cost_microdollars: nil)
      expect(described_class.call(user: user)).to be_success

      AiEmbeddingRequest.create!(user: user, model: "text-embedding-3-small", purpose: "career_library", cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS)

      expect(described_class.call(user: user).errors).to eq([ described_class::DAILY_LIMIT_MESSAGE ])
    end

    it "skips interviews in development-only unmetered testing, but not general AI" do
      create_finished_task(cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS)
      allow(Interviews::LocalTesting).to receive(:unmetered?).and_return(true)

      expect(described_class.call(user: user, interview: true)).to be_success
      expect(described_class.call(user: user)).not_to be_success
    end
  end

  describe "site-wide daily limit" do
    before do
      stub_const("SITE_DAILY_AI_BUDGET_MICRODOLLARS", 100)
      create(:ai_task, :completed_resume_parse, cost_microdollars: 100)
    end

    it "refuses general AI for a trial user with their own cap left" do
      expect(described_class.call(user: user).errors).to eq([ described_class::SITE_LIMIT_MESSAGE ])
    end

    it "refuses spoken interviews too" do
      expect(described_class.call(user: user, interview: true).errors).to eq([ described_class::SITE_LIMIT_MESSAGE ])
    end

    it "refuses the next step of work the user already started" do
      existing_task = create(:ai_task, user: user, task_type: "interview_turn")

      expect(described_class.call(user: user, existing_task: existing_task, interview: true).errors).to eq([ described_class::SITE_LIMIT_MESSAGE ])
    end

    it "never blocks a paying subscriber" do
      create(:billing_subscription, user: user)

      expect(described_class.call(user: user.reload)).to be_success
    end

    it "does not count paying subscribers' spend toward the site total" do
      paid_task = create(:ai_task, :completed_resume_parse, cost_microdollars: 1_000)
      create(:billing_subscription, user: paid_task.user)
      AiTask.where.not(id: paid_task.id).delete_all

      expect(described_class.call(user: user)).to be_success
    end

    it "counts background embedding spend" do
      stub_const("SITE_DAILY_AI_BUDGET_MICRODOLLARS", 150)
      expect(described_class.call(user: user)).to be_success

      AiEmbeddingRequest.create!(user: create(:user), model: "text-embedding-3-small", purpose: "career_library", cost_microdollars: 50)

      expect(described_class.call(user: user).errors).to eq([ described_class::SITE_LIMIT_MESSAGE ])
    end

    it "shows the user's own daily limit first" do
      create_finished_task(cost_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS)

      expect(described_class.call(user: user).errors).to eq([ described_class::DAILY_LIMIT_MESSAGE ])
    end

    it "lets work start again the next UTC day" do
      travel_to(1.day.from_now.utc.beginning_of_day) do
        expect(described_class.call(user: user)).to be_success
      end
    end

    it "skips interviews in development-only unmetered testing, but not general AI" do
      allow(Interviews::LocalTesting).to receive(:unmetered?).and_return(true)

      expect(described_class.call(user: user, interview: true)).to be_success
      expect(described_class.call(user: user)).not_to be_success
    end
  end

  describe "hourly limit" do
    it "refuses once the user started the default number of tasks in the last hour" do
      DEFAULT_AI_TASKS_PER_HOUR.times { create_finished_task }

      expect(described_class.call(user: user).errors.first).to start_with("You've started too many AI tasks")
    end

    it "ignores tasks older than an hour" do
      DEFAULT_AI_TASKS_PER_HOUR.times { create_finished_task(created_at: 61.minutes.ago) }

      expect(described_class.call(user: user)).to be_success
    end
  end

  describe "in-flight limit" do
    it "refuses once the user has the default number of queued tasks" do
      create_list(:ai_task, DEFAULT_MAX_IN_FLIGHT_AI_TASKS, user: user)

      expect(described_class.call(user: user).errors.first).to start_with("You already have AI tasks running")
    end

    it "ignores queued tasks old enough to be stuck" do
      create_list(:ai_task, DEFAULT_MAX_IN_FLIGHT_AI_TASKS, user: user, created_at: 16.minutes.ago)

      expect(described_class.call(user: user)).to be_success
    end

    it "doesn't count tasks waiting for the user's answer" do
      create_list(:ai_task, DEFAULT_MAX_IN_FLIGHT_AI_TASKS, user: user, status: "needs_user_input")

      expect(described_class.call(user: user)).to be_success
    end
  end
end

# Description: The per-user AI limits checked before a task is queued: monthly budget, hourly
# task limit, in-flight task limit, and per-user overrides.
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

  describe "monthly budget" do
    it "refuses once this month's spend reaches the default budget" do
      travel_to Time.utc(2026, 10, 15) do
        create_finished_task(cost_microdollars: DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS)

        result = described_class.call(user: user)

        expect(result.errors).to eq([ "You've reached this month's AI usage limit. It resets on November 1." ])
      end
    end

    it "ignores last month's spend" do
      travel_to Time.utc(2026, 11, 1, 0, 5) do
        create_finished_task(cost_microdollars: DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS, created_at: Time.utc(2026, 10, 31, 23, 55))

        expect(described_class.call(user: user)).to be_success
      end
    end

    it "uses the user's budget override" do
      user.update!(monthly_ai_budget_microdollars: DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS * 2)
      create_finished_task(cost_microdollars: DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS)

      expect(described_class.call(user: user)).to be_success
    end

    it "doesn't count other users' spend" do
      create(:ai_task, :completed_resume_parse, cost_microdollars: DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS)

      expect(described_class.call(user: user)).to be_success
    end
  end

  describe "site-wide daily limit" do
    before do
      stub_const("SITE_DAILY_AI_BUDGET_MICRODOLLARS", 100)
      create(:ai_task, :completed_resume_parse, cost_microdollars: 100)
    end

    it "refuses general AI for a user with their own budget left" do
      expect(described_class.call(user: user).errors).to eq([ described_class::SITE_LIMIT_MESSAGE ])
    end

    it "refuses spoken interviews too" do
      expect(described_class.call(user: user, interview: true).errors).to eq([ described_class::SITE_LIMIT_MESSAGE ])
    end

    it "refuses the next step of work the user already started" do
      existing_task = create(:ai_task, user: user, task_type: "interview_turn")

      expect(described_class.call(user: user, existing_task: existing_task, interview: true).errors).to eq([ described_class::SITE_LIMIT_MESSAGE ])
    end

    it "counts background embedding spend" do
      stub_const("SITE_DAILY_AI_BUDGET_MICRODOLLARS", 150)
      expect(described_class.call(user: user)).to be_success

      AiEmbeddingRequest.create!(user: create(:user), model: "text-embedding-3-small", purpose: "career_library", cost_microdollars: 50)

      expect(described_class.call(user: user).errors).to eq([ described_class::SITE_LIMIT_MESSAGE ])
    end

    it "shows the user's own monthly limit first, because that one won't clear tomorrow" do
      create_finished_task(cost_microdollars: DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS)

      expect(described_class.call(user: user).errors.first).to start_with("You've reached this month's AI usage limit")
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

    it "uses the user's override" do
      user.update!(ai_tasks_per_hour_limit: 1)
      create_finished_task

      expect(described_class.call(user: user)).not_to be_success
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

    it "uses the user's override" do
      user.update!(max_in_flight_ai_tasks: DEFAULT_MAX_IN_FLIGHT_AI_TASKS + 1)
      create_list(:ai_task, DEFAULT_MAX_IN_FLIGHT_AI_TASKS, user: user)

      expect(described_class.call(user: user)).to be_success
    end
  end
end

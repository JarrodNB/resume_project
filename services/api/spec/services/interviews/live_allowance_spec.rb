# How much hidden live budget a user has left: one budget over the whole trial, one per UTC day on a
# paid plan, none once the plan has ended. Counted from the live bills' actual cost, never from time.
require "rails_helper"

RSpec.describe Interviews::LiveAllowance do
  let(:user) { create(:user, trial_ends_at: 4.days.from_now) } # the trial started three days ago
  let(:trial) { described_class::TRIAL_MICRODOLLARS }
  let(:paid) { described_class::PAID_DAILY_MICRODOLLARS }

  # A live connection whose bill cost `cost` (nil: an entry the price list couldn't price).
  def live_connection(owner, billed_seconds: 0, cost: 0, created_at: Time.current, status: "ended")
    interview = owner.interview_sessions.create!(status: "completed", answer_cap: 1, execution_mode: "real",
      execution_config: Interviews::ExecutionConfiguration::PRESETS.fetch("real"), setup_config: Interviews::SetupConfiguration::DEFAULT.merge("question_count" => 5),
      conversation_mode: "live", preparation_kind: "fictional_role", expires_at: 7.days.from_now)
    task = owner.ai_tasks.create!(task_type: "interview_live_conversation", subject: interview, status: "completed", created_at: created_at)
    attempt = task.ai_usage_attempts.create!(attempt_id: SecureRandom.uuid)
    AiUsage::AttemptEntries.replace(attempt, [ { "stage" => "live_conversation", "provider" => "openai",
      "model" => "gpt-realtime-2.1-mini", "input_tokens" => 10, "cost_microdollars" => cost }.compact ], ai_task: task)
    interview.live_connections.create!(room_name: "interview-#{SecureRandom.hex(8)}", status: status, billed_seconds: billed_seconds,
      ai_task: task, created_at: created_at, ended_at: (status == "ended" ? created_at : nil), end_reason: (status == "ended" ? "completed" : nil))
  end

  it "gives a trial user one budget over the whole trial, spent by cost rather than time" do
    expect(described_class.remaining_microdollars(user)).to eq(trial)
    live_connection(user, billed_seconds: 1_200, cost: 100_000, created_at: 2.days.ago)
    live_connection(user, billed_seconds: 60, cost: 300_000)
    expect(described_class.remaining_microdollars(user)).to eq(trial - 400_000)
    live_connection(user, cost: trial)
    expect(described_class.remaining_microdollars(user)).to eq(0)
  end

  it "ignores live use from before the trial started and other users' use" do
    live_connection(user, cost: 300_000, created_at: 4.days.ago)
    live_connection(create(:user), cost: 400_000)
    expect(described_class.remaining_microdollars(user)).to eq(trial)
  end

  it "counts an unpriced bill at the conservative per-second cost of its counted time" do
    live_connection(user, billed_seconds: 300, cost: nil)
    expect(described_class.remaining_microdollars(user)).to eq(trial - 300 * described_class::UNPRICED_MICRODOLLARS_PER_SECOND)
  end

  it "refuses a new room below the start minimum, without saying any amount" do
    expect(described_class.start_refusal(user)).to be_nil
    live_connection(user, cost: trial - described_class::MIN_START_MICRODOLLARS + 1)
    expect(described_class.start_refusal(user)).to eq(described_class::TRIAL_USED)
    create(:billing_subscription, user: user)
    expect(described_class.start_refusal(user)).to be_nil
    live_connection(user, cost: paid)
    expect(described_class.start_refusal(user)).to eq(described_class::DAY_USED)
    expect(described_class::DAY_USED + described_class::TRIAL_USED).not_to match(/\d|\$/)
  end

  it "gives a paid user a budget per UTC day, counting a still-open connection from before midnight" do
    create(:billing_subscription, user: user)
    travel_to Time.utc(2026, 11, 27, 0, 10) do
      live_connection(user, cost: 400_000, created_at: Time.utc(2026, 11, 26, 23, 0))
      expect(described_class.remaining_microdollars(user)).to eq(paid)
      live_connection(user, cost: 200_000, created_at: Time.utc(2026, 11, 26, 23, 55), status: "connected")
      live_connection(user, cost: 100_000, created_at: Time.utc(2026, 11, 27, 0, 1))
      expect(described_class.remaining_microdollars(user)).to eq(paid - 300_000)
    end
  end

  it "keeps counting a session that crossed midnight once it ends, so ending it refunds nothing" do
    create(:billing_subscription, user: user)
    travel_to Time.utc(2026, 11, 27, 0, 10) do
      connection = live_connection(user, cost: 300_000, created_at: Time.utc(2026, 11, 26, 23, 50), status: "connected")
      expect(described_class.remaining_microdollars(user)).to eq(paid - 300_000)
      connection.update!(status: "ended", ended_at: Time.current, end_reason: "completed")
      expect(described_class.remaining_microdollars(user)).to eq(paid - 300_000)
    end
  end

  it "gives an ended plan no live budget" do
    expect(described_class.remaining_microdollars(create(:user, :trial_ended))).to eq(0)
  end

  it "counts a session's own billed seconds against its 25-minute clock" do
    connection = live_connection(user, billed_seconds: 400)
    live_connection(user, billed_seconds: 900)
    expect(described_class.session_seconds_left(connection.interview_session)).to eq(1_100)
    connection.update!(billed_seconds: 2_000)
    expect(described_class.session_seconds_left(connection.interview_session)).to eq(0)
  end
end

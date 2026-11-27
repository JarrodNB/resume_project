# How many live interview seconds a user has left: 10 minutes over the whole trial, 60 minutes a
# UTC day on a paid plan, none once the plan has ended. Counted from live connections' billed seconds.
require "rails_helper"

RSpec.describe Interviews::LiveAllowance do
  let(:user) { create(:user, trial_ends_at: 4.days.from_now) } # the trial started three days ago

  def live_connection(owner, billed_seconds:, created_at: Time.current, status: "ended")
    interview = owner.interview_sessions.create!(status: "completed", answer_cap: 1, execution_mode: "real",
      execution_config: Interviews::ExecutionConfiguration::PRESETS.fetch("real"), setup_config: Interviews::SetupConfiguration::DEFAULT.merge("question_count" => 5),
      conversation_mode: "live", preparation_kind: "fictional_role", expires_at: 7.days.from_now)
    interview.live_connections.create!(room_name: "interview-#{SecureRandom.hex(8)}", status: status, billed_seconds: billed_seconds,
      created_at: created_at, ended_at: (status == "ended" ? created_at : nil), end_reason: (status == "ended" ? "completed" : nil))
  end

  it "gives a trial user 10 minutes over the whole trial" do
    expect(described_class.remaining_seconds(user)).to eq(600)
    live_connection(user, billed_seconds: 120, created_at: 2.days.ago)
    live_connection(user, billed_seconds: 90)
    expect(described_class.remaining_seconds(user)).to eq(390)
    live_connection(user, billed_seconds: 500)
    expect(described_class.remaining_seconds(user)).to eq(0)
  end

  it "ignores live use from before the trial started and other users' use" do
    live_connection(user, billed_seconds: 300, created_at: 4.days.ago)
    live_connection(create(:user), billed_seconds: 400)
    expect(described_class.remaining_seconds(user)).to eq(600)
  end

  it "gives a paid user 60 minutes per UTC day, counting a still-open connection from before midnight" do
    create(:billing_subscription, user: user)
    travel_to Time.utc(2026, 11, 27, 0, 10) do
      live_connection(user, billed_seconds: 1_200, created_at: Time.utc(2026, 11, 26, 23, 0))
      expect(described_class.remaining_seconds(user)).to eq(3_600)
      live_connection(user, billed_seconds: 600, created_at: Time.utc(2026, 11, 26, 23, 55), status: "connected")
      live_connection(user, billed_seconds: 300, created_at: Time.utc(2026, 11, 27, 0, 1))
      expect(described_class.remaining_seconds(user)).to eq(2_700)
    end
  end

  it "keeps counting a session that crossed midnight once it ends, so ending it refunds nothing" do
    create(:billing_subscription, user: user)
    travel_to Time.utc(2026, 11, 27, 0, 10) do
      connection = live_connection(user, billed_seconds: 900, created_at: Time.utc(2026, 11, 26, 23, 50), status: "connected")
      expect(described_class.remaining_seconds(user)).to eq(2_700)
      connection.update!(status: "ended", ended_at: Time.current, end_reason: "completed")
      expect(described_class.remaining_seconds(user)).to eq(2_700)
    end
  end

  it "gives an ended plan no live minutes" do
    expect(described_class.remaining_seconds(create(:user, :trial_ended))).to eq(0)
  end

  it "counts a session's own billed seconds against its 25-minute clock" do
    connection = live_connection(user, billed_seconds: 400)
    live_connection(user, billed_seconds: 900)
    expect(described_class.session_seconds_left(connection.interview_session)).to eq(1_100)
    connection.update!(billed_seconds: 2_000)
    expect(described_class.session_seconds_left(connection.interview_session)).to eq(0)
  end
end

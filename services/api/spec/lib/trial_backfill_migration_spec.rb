# Runs the real migration against a temporary users table: verified accounts get a fresh 7-day
# trial from migration time, unverified accounts get none, and nothing else changes.
require "rails_helper"
require Rails.root.join("db/migrate/20261121050000_add_trial_and_daily_spend_cap_to_users")

RSpec.describe AddTrialAndDailySpendCapToUsers do
  it "starts a trial for confirmed users only" do
    connection = ActiveRecord::Base.connection
    connection.execute("CREATE TEMP TABLE users (id text PRIMARY KEY, confirmed_at timestamp)")
    connection.execute("INSERT INTO users VALUES ('verified', '2026-01-01'), ('unverified', NULL)")
    freeze_time do
      described_class.new.migrate(:up)
      trial_end = connection.select_value("SELECT trial_ends_at FROM users WHERE id = 'verified'")
      expect(trial_end).to be_within(1.minute).of(7.days.from_now)
    end
    expect(connection.select_value("SELECT trial_ends_at FROM users WHERE id = 'unverified'")).to be_nil
    expect(connection.select_value("SELECT daily_ai_spend_cap_microdollars FROM users WHERE id = 'verified'")).to be_nil
  ensure
    connection&.execute("DROP TABLE IF EXISTS pg_temp.users")
    connection&.schema_cache&.clear!
  end
end

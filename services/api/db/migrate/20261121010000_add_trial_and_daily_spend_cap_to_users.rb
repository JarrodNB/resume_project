# Gives every verified account a trial end date and adds the one per-user daily spend cap override.
# Accounts that are already verified get a fresh 7-day trial starting when this migration runs.
# The older monthly/hourly/in-flight override columns stay in place but are no longer read.
class AddTrialAndDailySpendCapToUsers < ActiveRecord::Migration[8.1]
  def up
    add_column :users, :trial_ends_at, :datetime
    add_column :users, :daily_ai_spend_cap_microdollars, :bigint
    execute "UPDATE users SET trial_ends_at = NOW() + INTERVAL '7 days' WHERE confirmed_at IS NOT NULL"
  end

  def down
    remove_column :users, :daily_ai_spend_cap_microdollars
    remove_column :users, :trial_ends_at
  end
end

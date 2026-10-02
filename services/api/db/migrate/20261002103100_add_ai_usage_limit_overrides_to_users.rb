# Description: Optional per-user overrides of the global AI usage limits (null = use the default
# from config/initializers/ai_usage_limits.rb).
class AddAiUsageLimitOverridesToUsers < ActiveRecord::Migration[8.1]
  def change
    change_table :users, bulk: true do |t|
      t.bigint :monthly_ai_budget_microdollars
      t.integer :ai_tasks_per_hour_limit
      t.integer :max_in_flight_ai_tasks
    end
  end
end

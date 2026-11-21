# Description: Drops the three old per-user AI limit override columns. Nothing reads them any more;
# the hidden daily spend cap override (users.daily_ai_spend_cap_microdollars) replaced them.
class RemoveOldAiLimitOverridesFromUsers < ActiveRecord::Migration[8.1]
  def change
    change_table :users, bulk: true do |t|
      t.remove :monthly_ai_budget_microdollars, type: :bigint
      t.remove :ai_tasks_per_hour_limit, type: :integer
      t.remove :max_in_flight_ai_tasks, type: :integer
    end
  end
end

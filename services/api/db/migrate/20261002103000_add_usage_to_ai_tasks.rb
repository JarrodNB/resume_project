# Description: Stores each AI task's token usage and estimated cost (reported by the worker), and
# indexes tasks by user and creation time for the monthly budget and hourly rate limit queries.
class AddUsageToAiTasks < ActiveRecord::Migration[8.1]
  def change
    change_table :ai_tasks, bulk: true do |t|
      t.integer :input_tokens, null: false, default: 0
      t.integer :cached_input_tokens, null: false, default: 0
      t.integer :output_tokens, null: false, default: 0
      t.bigint :cost_microdollars, null: false, default: 0
      t.index [ :user_id, :created_at ]
    end
  end
end

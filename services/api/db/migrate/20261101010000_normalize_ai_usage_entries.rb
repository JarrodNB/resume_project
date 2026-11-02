# Store each reported provider response as its own typed row so spend can be grouped by
# stage, model, task type or user in plain SQL. Replaces the per-attempt usage JSON list.
# Existing JSON detail is not copied; task totals already include those charges.
class NormalizeAiUsageEntries < ActiveRecord::Migration[8.1]
  COUNT_COLUMNS = %i[input_tokens cached_input_tokens cache_write_tokens output_tokens audio_milliseconds characters cost_microdollars].freeze

  def up
    create_table :ai_usage_entries, id: :uuid do |t|
      t.references :ai_usage_attempt, type: :uuid, null: false, index: false, foreign_key: { on_delete: :cascade }
      t.references :ai_task, type: :uuid, null: false, foreign_key: { on_delete: :cascade }
      t.integer :position, null: false
      t.string :stage
      t.string :provider
      t.string :model
      t.string :provider_response_id
      COUNT_COLUMNS.each { |column| t.bigint column }
      t.timestamps
      t.index [ :ai_usage_attempt_id, :position ], unique: true, name: "index_ai_usage_entries_on_attempt_and_position"
      t.check_constraint "position >= 0", name: "ai_usage_entry_position_nonnegative"
      t.check_constraint COUNT_COLUMNS.map { |column| "(#{column} IS NULL OR #{column} >= 0)" }.join(" AND "),
        name: "ai_usage_entry_counts_nonnegative"
    end
    remove_column :ai_usage_attempts, :usage
  end

  def down
    add_column :ai_usage_attempts, :usage, :jsonb, default: [], null: false
    drop_table :ai_usage_entries
  end
end

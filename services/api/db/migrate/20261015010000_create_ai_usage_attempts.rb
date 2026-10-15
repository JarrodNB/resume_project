# Description: Retains independently deduplicated attempt usage, including late and retry charges.
# Index:
#   - change: creates attempt reports without granting the AI reader write access
class CreateAiUsageAttempts < ActiveRecord::Migration[8.1]
  # Stores per-model usage and uncertainty while task columns retain known aggregate totals.
  def change
    create_table :ai_usage_attempts, id: :uuid do |table|
      table.references :ai_task, type: :uuid, null: false, foreign_key: true
      table.uuid :attempt_id, null: false
      table.jsonb :usage, null: false, default: []
      table.boolean :incomplete, null: false, default: false
      table.timestamps
    end
    add_index :ai_usage_attempts, :attempt_id, unique: true
  end
end

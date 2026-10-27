# Retain each background embedding request's cost even when vector persistence rolls back.
class CreateAiEmbeddingRequests < ActiveRecord::Migration[8.1]
  def change
    create_table :ai_embedding_requests, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: { on_delete: :cascade }
      t.string :model, null: false
      t.string :purpose, null: false
      t.bigint :input_tokens
      t.bigint :cost_microdollars
      t.boolean :incomplete, null: false, default: true
      t.boolean :finalized, null: false, default: false
      t.timestamps
    end
    add_index :ai_embedding_requests, [ :user_id, :created_at ]
    add_check_constraint :ai_embedding_requests, "input_tokens IS NULL OR input_tokens >= 0", name: "embedding_tokens_nonnegative"
    add_check_constraint :ai_embedding_requests, "cost_microdollars IS NULL OR cost_microdollars >= 0", name: "embedding_cost_nonnegative"

    create_table :ai_usage_reconciliations, id: :uuid do |t|
      t.string :receipt_reference, null: false
      t.uuid :attempt_id, null: false
      t.string :record_type, null: false
      t.jsonb :previous_usage, null: false, default: []
      t.jsonb :usage, null: false, default: []
      t.timestamps
    end
    add_index :ai_usage_reconciliations, :receipt_reference, unique: true
    add_index :ai_usage_reconciliations, [ :record_type, :attempt_id ], unique: true
  end
end

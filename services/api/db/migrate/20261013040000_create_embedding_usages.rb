# Description: Records billed career-library embedding requests independently of derived vectors.
# Index:
#   - change: creates user-owned embedding usage records
class CreateEmbeddingUsages < ActiveRecord::Migration[8.1]
  # Stores token usage and estimated cost for each successful API batch.
  def change
    create_table :embedding_usages, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: true
      t.string :model, null: false
      t.bigint :input_tokens, null: false
      t.bigint :cost_microdollars, null: false
      t.timestamps
    end
    add_index :embedding_usages, [ :user_id, :created_at ]
    add_check_constraint :embedding_usages, "input_tokens >= 0 AND cost_microdollars >= 0", name: "embedding_usage_nonnegative"
  end
end

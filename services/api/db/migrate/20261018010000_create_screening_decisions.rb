# Stores successful checks by exact protected content and policy, without copying source text.
class CreateScreeningDecisions < ActiveRecord::Migration[8.1]
  def change
    create_table :screening_decisions, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: { on_delete: :cascade }
      t.string :content_digest, null: false, limit: 64
      t.string :policy_identity, null: false, limit: 64
      t.datetime :created_at, null: false
      t.index [ :user_id, :content_digest, :policy_identity ], unique: true, name: "unique_screening_decision"
    end
    add_check_constraint :screening_decisions, "content_digest ~ '^[0-9a-f]{64}$'", name: "screening_content_digest"
    add_check_constraint :screening_decisions, "policy_identity ~ '^[0-9a-f]{64}$'", name: "screening_policy_identity"
  end
end

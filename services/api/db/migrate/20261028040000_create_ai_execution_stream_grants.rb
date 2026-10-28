# Short-lived observer capabilities bind a browser session to one execution attempt.
class CreateAiExecutionStreamGrants < ActiveRecord::Migration[8.1]
  def change
    create_table :ai_execution_stream_grants, id: :uuid do |t|
      t.references :user, null: false, type: :uuid, foreign_key: { on_delete: :cascade }
      t.string :session_digest, null: false
      t.string :feature, null: false
      t.uuid :operation_id, null: false
      t.uuid :attempt_id, null: false
      t.integer :claim_generation, null: false
      t.string :token_digest, null: false
      t.datetime :expires_at, null: false
      t.datetime :redeemed_at
      t.timestamps
    end
    add_index :ai_execution_stream_grants, :token_digest, unique: true
    add_index :ai_execution_stream_grants, :expires_at
    add_check_constraint :ai_execution_stream_grants, "claim_generation > 0", name: "ai_stream_grant_positive_generation"
  end
end

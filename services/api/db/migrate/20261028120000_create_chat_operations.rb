# Keeps durable chat execution separate from accepted dialogue and shared usage receipts.
class CreateChatOperations < ActiveRecord::Migration[8.1]
  def change
    create_table :chat_operations, id: :uuid do |t|
      t.references :chat_conversation, type: :uuid, null: false, foreign_key: true
      t.references :ai_task, type: :uuid, null: false, foreign_key: true
      t.string :idempotency_key, null: false
      t.text :message, null: false
      t.string :status, null: false, default: "pending"
      t.uuid :attempt_id
      t.integer :claim_generation, null: false, default: 0
      t.integer :execution_count, null: false, default: 0
      t.integer :cycle_execution_count, null: false, default: 0
      t.integer :expected_position, null: false, default: 0
      t.datetime :lease_expires_at
      t.datetime :execution_deadline
      t.datetime :retry_at
      t.datetime :retry_expires_at, null: false
      t.string :failure_code
      t.string :delivery_job_id
      t.string :recovery_job_id
      t.string :result_fingerprint
      t.jsonb :accepted_result, null: false, default: {}
      t.timestamps
      t.index [:chat_conversation_id, :idempotency_key], unique: true, name: "index_chat_operations_on_idempotency"
      t.index :chat_conversation_id, unique: true, where: "status IN ('pending', 'running')", name: "index_chat_operations_one_active"
    end
    add_check_constraint :chat_operations, "status IN ('pending','running','accepted','failed')", name: "chat_operation_status"
    add_check_constraint :chat_operations, "length(message) > 0", name: "chat_operation_message"
    create_table :chat_execution_attempts, id: :uuid do |t|
      t.references :chat_operation, type: :uuid, null: false, foreign_key: true
      t.uuid :attempt_id, null: false
      t.integer :claim_generation, null: false
      t.timestamps
      t.index :attempt_id, unique: true
    end
    create_table :chat_provider_attempts, id: :uuid do |t|
      t.references :chat_execution_attempt, type: :uuid, null: false, foreign_key: true
      t.uuid :observation_id, null: false
      t.string :stage, null: false
      t.string :provider, null: false
      t.string :model, null: false
      t.timestamps
      t.index :observation_id, unique: true
    end
    add_column :chat_messages, :screened_sha256, :string
  end
end

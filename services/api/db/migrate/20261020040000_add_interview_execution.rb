# Keeps execution recovery and billing attached to durable interview work, independently
# of accepted answers. Attempt rows survive claim replacement and preserve unknown cost.
class AddInterviewExecution < ActiveRecord::Migration[8.1]
  def change
    change_table :interview_session_operations do |t|
      t.references :ai_task, type: :uuid, index: false, foreign_key: { on_delete: :nullify }
      t.integer :execution_count, null: false, default: 0
      t.integer :cycle_execution_count, null: false, default: 0
      t.datetime :retry_at
      t.datetime :retry_expires_at
      t.string :failure_code
      t.string :checkpoint
    end
    add_index :interview_session_operations, :ai_task_id, unique: true, name: "interview_operation_unique_task", if_not_exists: true
    add_check_constraint :interview_session_operations, "execution_count BETWEEN 0 AND 6 AND cycle_execution_count BETWEEN 0 AND 3", name: "interview_operation_execution_caps"
    create_table :interview_execution_attempts, id: :uuid do |t|
      t.references :operation, null: false, type: :uuid, foreign_key: { to_table: :interview_session_operations, on_delete: :cascade }
      t.uuid :attempt_id, null: false
      t.integer :claim_generation, null: false
      t.timestamps
    end
    add_index :interview_execution_attempts, :attempt_id, unique: true
    add_index :interview_execution_attempts, [ :operation_id, :claim_generation ], unique: true
  end
end

# Persist the watchdog receipt and bounded infrastructure-recovery budget.
class AddAiExecutionRecovery < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_session_operations, :recovery_job_id, :uuid
    add_column :interview_session_operations, :delivery_job_id, :uuid
    create_table :ai_job_recoveries, id: :uuid do |t|
      t.uuid :active_job_id, null: false
      t.integer :recovery_count, null: false, default: 0
      t.string :last_error
      t.datetime :exhausted_at
      t.timestamps
    end
    add_index :ai_job_recoveries, :active_job_id, unique: true
    add_check_constraint :ai_job_recoveries, "recovery_count >= 0", name: "ai_job_recoveries_nonnegative_count"
  end
end

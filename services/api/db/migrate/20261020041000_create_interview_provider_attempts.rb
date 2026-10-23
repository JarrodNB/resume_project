# Each potentially charged provider call has its own durable start, even when several
# calls belong to the same execution. Its UUID also keys the shared usage ledger.
class CreateInterviewProviderAttempts < ActiveRecord::Migration[8.1]
  def change
    create_table :interview_provider_attempts, id: :uuid do |t|
      t.references :execution_attempt, null: false, type: :uuid, foreign_key: { to_table: :interview_execution_attempts, on_delete: :cascade }
      t.uuid :observation_id, null: false
      t.string :stage, null: false
      t.string :provider, null: false
      t.string :model, null: false
      t.timestamps
    end
    add_index :interview_provider_attempts, :observation_id, unique: true
  end
end

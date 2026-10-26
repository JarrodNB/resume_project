# Keeps each committed task outcome, including outcomes replaced by an explicit retry.
# Sequence is a cursor, not an identifier; owner locks serialize inserts through commit.
class CreateAiTaskOutcomes < ActiveRecord::Migration[8.1]
  def change
    create_table :ai_task_outcomes, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: true
      t.references :ai_task, type: :uuid, null: false, foreign_key: true
      t.bigserial :sequence, null: false
      t.string :task_type, null: false
      t.string :status, null: false
      t.datetime :completed_at, null: false
      t.timestamps
    end
    add_index :ai_task_outcomes, :sequence, unique: true
    add_index :ai_task_outcomes, [ :user_id, :sequence ], unique: true
    add_check_constraint :ai_task_outcomes, "status IN ('completed', 'failed')", name: "ai_task_outcomes_terminal_status"
  end
end

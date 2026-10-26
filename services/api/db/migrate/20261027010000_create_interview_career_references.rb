# Stores prompt-linked evidence independently from dialogue and preserves its usage ledger.
class CreateInterviewCareerReferences < ActiveRecord::Migration[8.1]
  def change
    create_table :interview_career_references, id: :uuid do |t|
      t.references :interview_session, type: :uuid, null: false, foreign_key: true
      t.references :message, type: :uuid, null: false, foreign_key: { to_table: :interview_session_messages }, index: { unique: true }
      t.references :ai_task, type: :uuid, foreign_key: { on_delete: :nullify }
      t.integer :attempt_count, null: false, default: 0
      t.datetime :claimed_at
      t.datetime :deadline
      t.jsonb :references, null: false, default: []
      t.string :policy_version, null: false, default: "1"
      t.timestamps
    end
    add_check_constraint :interview_career_references, "attempt_count BETWEEN 0 AND 2 AND jsonb_typeof(\"references\") = 'array' AND jsonb_array_length(\"references\") <= 3", name: "interview_career_reference_bounds"
    add_index :interview_session_messages, [:interview_session_id, :id], unique: true, name: "interview_message_session_identity"
    add_foreign_key :interview_career_references, :interview_session_messages, column: [:interview_session_id, :message_id], primary_key: [:interview_session_id, :id]
    remove_check_constraint :ai_tasks, name: "ai_task_hourly_interview_child"
    add_check_constraint :ai_tasks, "hourly_admission_task_id IS NULL OR (hourly_admission_task_id <> id AND task_type IN ('interview_turn', 'interview_speech', 'interview_transcription', 'interview_clarification', 'interview_references') AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL)", name: "ai_task_hourly_interview_child"
  end
end

# Saves one reusable explanation per exact interviewer message, with bounded queue attempts.
class CreateInterviewClarifications < ActiveRecord::Migration[8.1]
  def change
    create_table :interview_clarifications, id: :uuid do |t|
      t.references :interview_session, type: :uuid, null: false, foreign_key: true
      t.references :message, type: :uuid, null: false, foreign_key: { to_table: :interview_session_messages }, index: { unique: true }
      t.references :ai_task, type: :uuid, foreign_key: { on_delete: :nullify }
      t.integer :attempt_count, null: false, default: 0
      t.datetime :claimed_at
      t.datetime :deadline
      t.text :explanation
      t.timestamps
    end
    add_check_constraint :interview_clarifications, "attempt_count BETWEEN 0 AND 2 AND (explanation IS NULL OR char_length(explanation) BETWEEN 1 AND 1000)", name: "interview_clarification_bounds"
    remove_check_constraint :ai_tasks, "hourly_admission_task_id IS NULL OR (hourly_admission_task_id <> id AND task_type IN ('interview_turn', 'interview_speech', 'interview_transcription') AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL)", name: "ai_task_hourly_interview_child"
    add_check_constraint :ai_tasks, "hourly_admission_task_id IS NULL OR (hourly_admission_task_id <> id AND task_type IN ('interview_turn', 'interview_speech', 'interview_transcription', 'interview_clarification') AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL)", name: "ai_task_hourly_interview_child"
  end
end

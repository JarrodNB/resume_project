# Keeps one retained coaching result per completed interview, separate from its dialogue.
class CreateInterviewSessionFeedbacks < ActiveRecord::Migration[8.1]
  def change
    create_table :interview_session_feedbacks, id: :uuid do |t|
      t.references :interview_session, type: :uuid, null: false, foreign_key: true, index: { unique: true }
      t.references :ai_task, type: :uuid, foreign_key: { on_delete: :nullify }
      t.integer :attempt_count, null: false, default: 0
      t.integer :expected_revision, null: false
      t.datetime :claimed_at
      t.datetime :deadline
      t.jsonb :content, null: false, default: {}
      t.timestamps
    end
    add_check_constraint :interview_session_feedbacks, "attempt_count BETWEEN 0 AND 2 AND jsonb_typeof(content) = 'object'", name: "interview_session_feedback_bounds"
    remove_check_constraint :ai_tasks, "hourly_admission_task_id IS NULL OR (hourly_admission_task_id <> id AND task_type IN ('interview_turn', 'interview_speech', 'interview_transcription', 'interview_clarification', 'interview_references') AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL)", name: "ai_task_hourly_interview_child"
    add_check_constraint :ai_tasks, "hourly_admission_task_id IS NULL OR (hourly_admission_task_id <> id AND task_type IN ('interview_turn', 'interview_speech', 'interview_transcription', 'interview_clarification', 'interview_references', 'interview_session_feedback') AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL)", name: "ai_task_hourly_interview_child"
  end
end

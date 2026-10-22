# Keep pre-answer streaming admission and its costs separate from submitted turns.
class CreateInterviewTranscriptionCaptures < ActiveRecord::Migration[8.1]
  def change
    create_table :interview_transcription_captures, id: :uuid do |t|
      t.references :interview_session, type: :uuid, null: false, foreign_key: true
      t.references :question, type: :uuid, null: false, foreign_key: { to_table: :interview_session_questions }
      t.references :ai_task, type: :uuid, foreign_key: true
      t.integer :expected_revision, null: false
      t.string :status, null: false, default: "authorized"
      t.string :token_digest, null: false
      t.uuid :observation_id, null: false
      t.datetime :expires_at, null: false
      t.text :transcript
      t.timestamps
    end
    add_index :interview_transcription_captures, :token_digest, unique: true
    add_index :interview_transcription_captures, :observation_id, unique: true
    add_check_constraint :interview_transcription_captures,
      "status IN ('authorized', 'streaming', 'completed', 'failed')", name: "interview_capture_status"
    add_check_constraint :interview_transcription_captures,
      "expected_revision >= 0 AND (transcript IS NULL OR char_length(transcript) <= 4000)", name: "interview_capture_limits"
    remove_check_constraint :ai_tasks,
      "hourly_admission_task_id IS NULL OR (hourly_admission_task_id <> id AND task_type IN ('interview_turn', 'interview_speech') AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL)",
      name: "ai_task_hourly_interview_child"
    add_check_constraint :ai_tasks,
      "hourly_admission_task_id IS NULL OR (hourly_admission_task_id <> id AND task_type IN ('interview_turn', 'interview_speech', 'interview_transcription') AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL)",
      name: "ai_task_hourly_interview_child"
  end
end

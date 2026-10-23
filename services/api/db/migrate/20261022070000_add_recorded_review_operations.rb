# Complete recordings can be transcribed before any answer is committed.
class AddRecordedReviewOperations < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :interview_session_operations, name: "interview_session_operation_states"
    add_check_constraint :interview_session_operations, "kind IN ('preparation','turn','speech','transcription') AND status IN ('pending','running','accepted','failed','expired') AND claim_generation >= 0", name: "interview_session_operation_states"
    remove_check_constraint :interview_session_operations, name: "interview_session_operation_inputs"
    add_check_constraint :interview_session_operations, "(kind = 'preparation' AND question_id IS NULL AND message_id IS NULL AND recording_id IS NULL AND submission_key IS NULL) OR (kind = 'turn' AND question_id IS NOT NULL AND submission_key IS NOT NULL AND request_fingerprint IS NOT NULL AND (recording_id IS NOT NULL OR transcription_mode = 'typed') AND expected_revision IS NOT NULL AND expected_revision >= 0 AND message_id IS NULL) OR (kind = 'speech' AND question_id IS NOT NULL AND message_id IS NOT NULL AND submission_key IS NULL) OR (kind = 'transcription' AND question_id IS NOT NULL AND recording_id IS NOT NULL AND expected_revision IS NOT NULL AND expected_revision >= 0 AND message_id IS NULL AND submission_key IS NULL)", name: "interview_session_operation_inputs"
    add_index :interview_session_operations, :recording_id, unique: true, where: "kind = 'transcription'", name: "interview_one_recorded_transcription"
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end

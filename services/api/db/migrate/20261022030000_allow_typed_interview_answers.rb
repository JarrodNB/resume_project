# Adds reviewed text turns alongside historical audio turns without rewriting saved work.
# Typed content can later be purged while its permanent submission/accounting identity remains.
class AllowTypedInterviewAnswers < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :interview_session_operations, name: "interview_operation_transcription_mode"
    add_check_constraint :interview_session_operations, "transcription_mode IN ('recorded', 'browser', 'streaming', 'typed')", name: "interview_operation_transcription_mode"
    remove_check_constraint :interview_session_operations, name: "interview_session_operation_inputs"
    add_check_constraint :interview_session_operations, "(kind = 'preparation' AND question_id IS NULL AND message_id IS NULL AND recording_id IS NULL AND submission_key IS NULL) OR (kind = 'turn' AND question_id IS NOT NULL AND submission_key IS NOT NULL AND request_fingerprint IS NOT NULL AND (recording_id IS NOT NULL OR transcription_mode = 'typed') AND expected_revision IS NOT NULL AND expected_revision >= 0 AND message_id IS NULL) OR (kind = 'speech' AND question_id IS NOT NULL AND message_id IS NOT NULL AND submission_key IS NULL)", name: "interview_session_operation_inputs"
  end

  def down
    remove_check_constraint :interview_session_operations, name: "interview_session_operation_inputs"
    add_check_constraint :interview_session_operations, "(kind = 'preparation' AND question_id IS NULL AND message_id IS NULL AND recording_id IS NULL AND submission_key IS NULL) OR (kind = 'turn' AND question_id IS NOT NULL AND submission_key IS NOT NULL AND request_fingerprint IS NOT NULL AND recording_id IS NOT NULL AND expected_revision IS NOT NULL AND expected_revision >= 0 AND message_id IS NULL) OR (kind = 'speech' AND question_id IS NOT NULL AND message_id IS NOT NULL AND submission_key IS NULL)", name: "interview_session_operation_inputs"
    remove_check_constraint :interview_session_operations, name: "interview_operation_transcription_mode"
    add_check_constraint :interview_session_operations, "transcription_mode IN ('recorded', 'browser', 'streaming')", name: "interview_operation_transcription_mode"
  end
end

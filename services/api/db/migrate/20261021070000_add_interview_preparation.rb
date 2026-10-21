# Adds durable preparation without rewriting existing fixture sessions or their caps.
class AddInterviewPreparation < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_sessions, :frozen_context, :jsonb, null: false, default: {}
    add_column :interview_sessions, :prepared_role, :jsonb, null: false, default: {}
    add_column :interview_session_questions, :question_type, :string, null: false, default: "behavioral"
    add_check_constraint :interview_session_questions, "question_type IN ('behavioral', 'technical', 'knowledge')", name: "interview_question_type"
    remove_check_constraint :interview_sessions, name: "interview_session_status"
    add_check_constraint :interview_sessions, "status IN ('preparing', 'ready', 'active', 'completed', 'expired')", name: "interview_session_status"
    change_column_null :interview_session_operations, :question_id, true
    remove_check_constraint :interview_session_operations, name: "interview_session_operation_states"
    add_check_constraint :interview_session_operations, "kind IN ('preparation', 'turn', 'speech') AND status IN ('pending', 'running', 'accepted', 'failed', 'expired') AND claim_generation >= 0", name: "interview_session_operation_states"
    remove_check_constraint :interview_session_operations, name: "interview_session_operation_inputs"
    add_check_constraint :interview_session_operations, "(kind = 'preparation' AND question_id IS NULL AND message_id IS NULL AND recording_id IS NULL AND submission_key IS NULL) OR (kind = 'turn' AND question_id IS NOT NULL AND submission_key IS NOT NULL AND request_fingerprint IS NOT NULL AND recording_id IS NOT NULL AND expected_revision IS NOT NULL AND expected_revision >= 0 AND message_id IS NULL) OR (kind = 'speech' AND question_id IS NOT NULL AND message_id IS NOT NULL AND submission_key IS NULL)", name: "interview_session_operation_inputs"
    add_index :interview_session_operations, :interview_session_id, unique: true, where: "kind = 'preparation'", name: "interview_one_preparation"
  end
end

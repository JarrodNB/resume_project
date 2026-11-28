# Live connections bill through the provider ledger: each claimed connection gets one AI task and
# one provider observation (its verification reservation and usage report), and heartbeats are
# applied once each by their increasing sequence number.
class AddLiveHeartbeatAndLedgerToInterviewLiveConnections < ActiveRecord::Migration[8.1]
  CHILD_TYPES = %w[interview_turn interview_speech interview_transcription interview_clarification interview_references interview_session_feedback].freeze

  def up
    add_column :interview_live_connections, :heartbeat_sequence, :integer, null: false, default: 0
    add_column :interview_live_connections, :observation_id, :uuid
    add_reference :interview_live_connections, :ai_task, type: :uuid, foreign_key: true, index: { unique: true }
    add_index :interview_live_connections, :observation_id, unique: true
    add_check_constraint :interview_live_connections, "heartbeat_sequence >= 0", name: "interview_live_connection_heartbeat_sequence"
    replace_hourly_child_types(CHILD_TYPES + %w[interview_live_conversation])
  end

  def down
    replace_hourly_child_types(CHILD_TYPES)
    remove_check_constraint :interview_live_connections, name: "interview_live_connection_heartbeat_sequence"
    remove_index :interview_live_connections, :observation_id
    remove_reference :interview_live_connections, :ai_task, foreign_key: true, index: { unique: true }
    remove_column :interview_live_connections, :observation_id
    remove_column :interview_live_connections, :heartbeat_sequence
  end

  private

  def replace_hourly_child_types(types)
    remove_check_constraint :ai_tasks, name: "ai_task_hourly_interview_child"
    add_check_constraint :ai_tasks,
      "hourly_admission_task_id IS NULL OR hourly_admission_task_id <> id AND task_type IN (#{types.map { |type| "'#{type}'" }.join(', ')}) " \
      "AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL",
      name: "ai_task_hourly_interview_child"
  end
end

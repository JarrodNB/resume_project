# One row per live room join. Each connection keeps its own billed seconds and end reason (a
# session's counted time is the sum over its connections); the partial unique index keeps at most
# one open connection per session.
class CreateInterviewLiveConnections < ActiveRecord::Migration[8.1]
  def change
    create_table :interview_live_connections, id: :uuid do |t|
      t.references :interview_session, type: :uuid, null: false, foreign_key: true, index: false
      t.string :room_name, null: false
      t.string :status, null: false, default: "authorized"
      t.datetime :connected_at
      t.datetime :last_heartbeat_at
      t.datetime :ended_at
      t.integer :billed_seconds, null: false, default: 0
      t.string :end_reason
      t.timestamps
    end
    add_index :interview_live_connections, :room_name, unique: true
    add_index :interview_live_connections, :interview_session_id, unique: true, where: "status <> 'ended'",
      name: "index_interview_live_connections_one_open_per_session"
    add_index :interview_live_connections, [ :interview_session_id, :created_at ]
    add_check_constraint :interview_live_connections, "status IN ('authorized', 'connected', 'ended')", name: "interview_live_connection_status"
    add_check_constraint :interview_live_connections, "billed_seconds >= 0", name: "interview_live_connection_billed_seconds"
    add_check_constraint :interview_live_connections,
      "end_reason IS NULL OR end_reason IN ('completed', 'time_limit', 'allowance', 'ended_by_candidate', 'disconnected', 'failed')",
      name: "interview_live_connection_end_reason"
  end
end

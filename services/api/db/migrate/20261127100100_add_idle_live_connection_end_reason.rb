# A live interview whose coaching menu waited three minutes without a choice closes with the
# end reason `idle`.
class AddIdleLiveConnectionEndReason < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :interview_live_connections, name: "interview_live_connection_end_reason"
    add_check_constraint :interview_live_connections,
      "end_reason IS NULL OR end_reason IN ('completed', 'time_limit', 'allowance', 'ended_by_candidate', 'disconnected', 'failed', 'idle')",
      name: "interview_live_connection_end_reason"
  end

  def down
    remove_check_constraint :interview_live_connections, name: "interview_live_connection_end_reason"
    add_check_constraint :interview_live_connections,
      "end_reason IS NULL OR end_reason IN ('completed', 'time_limit', 'allowance', 'ended_by_candidate', 'disconnected', 'failed')",
      name: "interview_live_connection_end_reason"
  end
end

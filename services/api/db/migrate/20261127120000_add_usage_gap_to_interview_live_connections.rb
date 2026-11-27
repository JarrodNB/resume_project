# A fresh agent that takes over a running live connection cannot report the usage the first agent
# spent after its last heartbeat, so the connection remembers the gap and its bill closes unknown.
class AddUsageGapToInterviewLiveConnections < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_live_connections, :usage_gap, :boolean, null: false, default: false
  end
end

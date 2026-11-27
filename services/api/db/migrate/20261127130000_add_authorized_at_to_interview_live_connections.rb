# A rejoin reuses the open live connection with a fresh 10-minute join token, so the wait for the
# agent's claim counts from the latest join, not from when the connection was created. Rows
# without it count from `created_at`.
class AddAuthorizedAtToInterviewLiveConnections < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_live_connections, :authorized_at, :datetime
  end
end

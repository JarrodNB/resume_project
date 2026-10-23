# Preserve abandoned sessions and their billing records as a distinct terminal state.
class AllowAbandonedInterviews < ActiveRecord::Migration[8.1]
  def change
    remove_check_constraint :interview_sessions,
      "status IN ('preparing', 'ready', 'active', 'completed', 'expired')", name: "interview_session_status"
    add_check_constraint :interview_sessions,
      "status IN ('preparing', 'ready', 'active', 'completed', 'expired', 'abandoned')", name: "interview_session_status"
  end
end

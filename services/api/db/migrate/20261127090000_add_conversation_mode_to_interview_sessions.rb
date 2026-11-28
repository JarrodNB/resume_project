# Lets a session run as the existing turn-based interview or as a live voice conversation.
# Every existing session stays turn-based.
class AddConversationModeToInterviewSessions < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_sessions, :conversation_mode, :string, null: false, default: "turn_based"
    add_check_constraint :interview_sessions, "conversation_mode IN ('turn_based', 'live')", name: "interview_conversation_mode"
  end
end

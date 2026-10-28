# Stores lightweight feedback on accepted replies, independently of model inputs and execution accounting.
class AddChatReplyFeedback < ActiveRecord::Migration[8.1]
  def change
    add_column :chat_messages, :thumbs_down, :boolean, null: false, default: false
    add_check_constraint :chat_messages, "role = 'assistant' OR thumbs_down = false", name: "chat_feedback_assistant_only"
  end
end

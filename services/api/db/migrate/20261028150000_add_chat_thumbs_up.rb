# Store one mutually exclusive feedback choice on accepted assistant messages.
class AddChatThumbsUp < ActiveRecord::Migration[8.1]
  def change
    add_column :chat_messages, :thumbs_up, :boolean, null: false, default: false
    add_check_constraint :chat_messages, "role = 'assistant' OR thumbs_up = false", name: "chat_positive_feedback_assistant_only"
    add_check_constraint :chat_messages, "NOT (thumbs_up AND thumbs_down)", name: "chat_feedback_one_choice"
  end
end

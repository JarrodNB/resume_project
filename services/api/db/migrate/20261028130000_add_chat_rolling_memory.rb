# Retains one versioned model-context summary while leaving accepted public history intact.
class AddChatRollingMemory < ActiveRecord::Migration[8.1]
  def change
    add_column :chat_conversations, :summary_text, :text, null: false, default: ""
    add_column :chat_conversations, :summary_version, :integer, null: false, default: 0
    add_column :chat_conversations, :summary_through_position, :integer, null: false, default: 0
    add_check_constraint :chat_conversations, "char_length(summary_text) <= 8000 AND summary_version >= 0 AND summary_through_position >= 0 AND summary_through_position % 2 = 0", name: "chat_summary_bounds"
    add_check_constraint :chat_conversations, "(summary_version = 0 AND summary_through_position = 0 AND summary_text = '') OR (summary_version > 0 AND summary_through_position > 0 AND char_length(summary_text) > 0)", name: "chat_summary_checkpoint"
    add_column :chat_operations, :summary_base_version, :integer, null: false, default: 0
    add_column :chat_operations, :summary_plan, :jsonb, null: false, default: {}
    add_check_constraint :chat_operations, "summary_base_version >= 0 AND jsonb_typeof(summary_plan) = 'object'", name: "chat_operation_summary_snapshot"
  end
end

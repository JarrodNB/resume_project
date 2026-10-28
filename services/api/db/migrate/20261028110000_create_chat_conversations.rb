# Stores private saved chats and their accepted messages independently of model execution attempts.
class CreateChatConversations < ActiveRecord::Migration[8.1]
  def change
    create_table :chat_conversations, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: true
      t.string :title, null: false, default: "New chat"
      t.timestamps
      t.index [ :user_id, :created_at, :id ], name: "index_chat_conversations_on_owner_history"
    end
    create_table :chat_messages, id: :uuid do |t|
      t.references :chat_conversation, type: :uuid, null: false, foreign_key: true
      t.integer :position, null: false
      t.string :role, null: false
      t.text :content, null: false
      t.timestamps
      t.index [ :chat_conversation_id, :position ], unique: true
    end
    add_check_constraint :chat_messages, "position > 0", name: "chat_message_positive_position"
    add_check_constraint :chat_messages, "role IN ('user', 'assistant')", name: "chat_message_role"
    add_check_constraint :chat_messages, "length(content) > 0", name: "chat_message_content_present"
  end
end

# One accepted user or assistant message. Failed and provisional output lives in execution state.
class ChatMessage < ApplicationRecord
  ROLES = %w[user assistant].freeze

  belongs_to :chat_conversation
  enum :role, ROLES.index_with(&:itself), validate: true
  validates :position, numericality: { only_integer: true, greater_than: 0 }, uniqueness: { scope: :chat_conversation_id }
  validates :content, presence: true
end

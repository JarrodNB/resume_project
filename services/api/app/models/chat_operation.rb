# One logical chat submission and its fenced durable execution, separate from accepted messages.
class ChatOperation < ApplicationRecord
  STATUSES = %w[pending running accepted failed].freeze
  belongs_to :chat_conversation
  belongs_to :ai_task
  has_many :execution_attempts, class_name: "ChatExecutionAttempt", dependent: :destroy
  enum :status, STATUSES.index_with(&:itself), validate: true
  validates :idempotency_key, presence: true, length: { maximum: 100 }, uniqueness: { scope: :chat_conversation_id }
  validates :message, presence: true
end

# A private saved conversation. Only accepted public dialogue belongs in its messages.
class ChatConversation < ApplicationRecord
  belongs_to :user
  has_many :messages, -> { order(:position) }, class_name: "ChatMessage", dependent: :destroy

  validates :title, presence: true, length: { maximum: 200 }
end

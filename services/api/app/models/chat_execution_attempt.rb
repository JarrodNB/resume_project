# Retains each execution identity even when its logical submission is retried.
class ChatExecutionAttempt < ApplicationRecord
  belongs_to :chat_operation
  has_many :provider_attempts, class_name: "ChatProviderAttempt", dependent: :destroy
end

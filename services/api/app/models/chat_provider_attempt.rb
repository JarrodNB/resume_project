# Binds each real provider request to its operation and shared accounting marker.
class ChatProviderAttempt < ApplicationRecord
  belongs_to :chat_execution_attempt
end

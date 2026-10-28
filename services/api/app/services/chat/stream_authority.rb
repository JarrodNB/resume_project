# Shared observer grants use owner/current-attempt authority without starting or mutating work.
module Chat
  module StreamAuthority
    def self.operation(operation_id, user)
      ChatOperation.joins(:chat_conversation).where(chat_conversations: { user_id: user.id }).find_by(id: operation_id)
    rescue ArgumentError
      nil
    end
    def self.lock(operation)
      operation.chat_conversation.lock!
      operation.lock!
    end
    def self.expires_at(operation)
      operation.retry_expires_at
    end
    def self.current?(operation, attempt_id:, claim_generation:)
      operation.attempt_id.present? && operation.attempt_id == attempt_id && operation.claim_generation == claim_generation &&
        operation.retry_expires_at > Time.current && (operation.accepted? || (operation.running? && operation.lease_expires_at &&
        operation.execution_deadline && operation.lease_expires_at > Time.current && operation.execution_deadline > Time.current))
    end
  end
end

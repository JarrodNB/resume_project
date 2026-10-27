# Resolve observer authority from current Rails state, never a browser-supplied topic.
module AiExecutions
  module StreamAuthority
    def self.operation(feature, operation_id, user)
      operation = Features.operation(feature, operation_id)
      operation if operation&.interview_session&.user_id == user.id
    rescue ArgumentError
      nil
    end

    def self.current?(operation, attempt_id:, claim_generation:)
      interview = operation.interview_session
      interview.expires_at > Time.current && !interview.abandoned? && !interview.expired? &&
        (operation.running? || operation.accepted?) && operation.attempt_id == attempt_id &&
        operation.claim_generation == claim_generation &&
        (operation.accepted? || (operation.lease_expires_at > Time.current && operation.execution_deadline > Time.current))
    end
  end
end

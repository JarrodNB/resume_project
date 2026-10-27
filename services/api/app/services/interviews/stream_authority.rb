# Resolve observer authority from current Rails state, never a browser-supplied topic.
module Interviews
  module StreamAuthority
    def self.operation(operation_id, user)
      operation = InterviewSessionOperation.find_by(id: operation_id)
      operation if operation&.interview_session&.user_id == user.id
    rescue ArgumentError
      nil
    end

    def self.lock(operation)
      operation.interview_session.lock!
      operation.lock!
    end

    def self.expires_at(operation)
      operation.interview_session.expires_at
    end

    def self.current?(operation, attempt_id:, claim_generation:)
      interview = operation.interview_session
      interview.expires_at > Time.current && !interview.abandoned? && !interview.expired? &&
        (operation.running? || operation.accepted?) && operation.attempt_id == attempt_id &&
        operation.claim_generation == claim_generation &&
        (operation.accepted? || (operation.lease_expires_at && operation.execution_deadline &&
          operation.lease_expires_at > Time.current && operation.execution_deadline > Time.current))
    end
  end
end

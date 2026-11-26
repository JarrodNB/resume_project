# What is specific to chat when the shared operation lifecycle runs a chat reply.
#
# The shared rules (leases, fencing, retry budgets, recovery) live in
# `AiExecutions::OperationLifecycle`. This file only says: the conversation is the lock
# owner, which failure codes are final, and when a reply counts as finished.
module Chat
  class OperationPolicy < AiExecutions::OperationPolicy
    FAILURE_CODES = %w[ai_usage_limit_reached plan_ended dependency_unavailable context_limit screening_blocked screening_unavailable execution_failed execution_timeout lease_expired].freeze
    NON_RETRYABLE_CODES = %w[screening_blocked screening_unavailable context_limit].freeze

    def feature = "chat"

    def owner = operation.chat_conversation

    def failure_codes = FAILURE_CODES

    def non_retryable_codes = NON_RETRYABLE_CODES

    def claim_allowed? = operation.retry_expires_at > Time.current

    # Accepted replies are final. A reported failure counts only while its lease is still live.
    def finished_state?
      operation.accepted? || (operation.failure_code.present? && operation.lease_expires_at &&
        operation.lease_expires_at > Time.current && operation.execution_deadline > Time.current)
    end

    def invalid_failure_message = "Invalid failure report"

    # A failure report for an already accepted reply changes nothing.
    def settled_failure_report = (operation.accepted? ? { status: operation.status } : nil)

    def after_failure(_code, retryable:, automatic:)
      PublishUpdateService.call(conversation: operation.chat_conversation)
    end
  end
end

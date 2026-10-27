# Share bounded database-availability retries for idempotent AI delivery jobs.
module AiExecutions
  class DurableJob < ApplicationJob
    TRANSIENT_ERRORS = [ ActiveRecord::Deadlocked, ActiveRecord::LockWaitTimeout,
      ActiveRecord::ConnectionNotEstablished, ActiveRecord::ConnectionTimeoutError,
      ActiveRecord::ConnectionFailed ].freeze
    self.enqueue_after_transaction_commit = false
    queue_as :ai_executions
    retry_on(*TRANSIENT_ERRORS, wait: 1.second, attempts: 5) do |job, _error|
      job.stop_delivery
    end
  end
end

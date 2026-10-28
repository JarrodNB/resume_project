# Shared dispatcher consults current committed chat authority, never transient HTTP receipts.
module Chat
  class DeliveryStateService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:, delivery_job_id: nil)
      @operation, @delivery_job_id = operation, delivery_job_id
    end
    def call
      with_operation_lock do
        next success({ delivered: true }) if @delivery_job_id && @operation.delivery_job_id != @delivery_job_id
        if @operation.pending? && @operation.retry_expires_at <= Time.current
          fail_execution("execution_timeout", retryable: false)
        end
        terminal = @operation.accepted? || @operation.failed?
        recovery = @operation.running? && @operation.recovery_job_id.present? && @operation.lease_expires_at > Time.current && @operation.execution_deadline > Time.current
        success({ delivered: terminal || recovery, retry_at: @operation.retry_at })
      end
    end
  end
end

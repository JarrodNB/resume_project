# Surface exhausted infrastructure retries only when the shared job still owns this chat fence.
module Chat
  class StopDeliveryService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:, delivery_job_id: nil, attempt_id: nil, generation: nil, recovery_job_id: nil)
      @operation, @delivery_job_id, @attempt_id, @generation, @recovery_job_id = operation, delivery_job_id, attempt_id, generation, recovery_job_id
    end
    def call
      with_operation_lock do
        delivery = @delivery_job_id && @operation.delivery_job_id == @delivery_job_id && @operation.pending?
        recovery = @recovery_job_id && @operation.recovery_job_id == @recovery_job_id && @operation.attempt_id == @attempt_id &&
          @operation.claim_generation == @generation && @operation.running? && [@operation.lease_expires_at, @operation.execution_deadline].min <= Time.current
        fail_execution("dependency_unavailable", retryable: false) if delivery || recovery
        success
      end
    end
  end
end

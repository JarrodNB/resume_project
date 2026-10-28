# Recover the exact expired attempt targeted by the shared durable watchdog job.
module Chat
  class RecoverOperationService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:, attempt_id:, generation:, expected_at:, job_id:)
      @operation, @attempt_id, @generation, @expected_at, @job_id = operation, attempt_id, generation, Time.iso8601(expected_at), job_id
    end
    def call
      with_operation_lock do
        next success unless @operation.running? && @operation.attempt_id == @attempt_id && @operation.claim_generation == @generation && @operation.recovery_job_id == @job_id
        at = [@operation.lease_expires_at, @operation.execution_deadline].min
        if at > Time.current
          ScheduleRecoveryService.call(operation: @operation)
          next success
        end
        next success if (at - @expected_at).abs > 0.001
        fail_execution(@operation.execution_deadline <= Time.current ? "execution_timeout" : "lease_expired", retryable: true)
        success
      end
    end
  end
end

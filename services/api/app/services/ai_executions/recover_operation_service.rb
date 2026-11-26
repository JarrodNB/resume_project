# Recover the exact expired attempt targeted by the durable watchdog job (chat and interviews).
# A job for an older attempt, or one that fires early, is a harmless no-op.
module AiExecutions
  class RecoverOperationService < ApplicationService
    def initialize(operation:, attempt_id:, generation:, expected_at:, job_id:)
      @operation, @attempt_id, @generation, @expected_at, @job_id = operation, attempt_id, generation, Time.iso8601(expected_at), job_id
    end

    def call
      lifecycle = OperationLifecycle.for(@operation)
      lifecycle.with_lock do
        next success unless @operation.running? && @operation.attempt_id == @attempt_id &&
          @operation.claim_generation == @generation && @operation.recovery_job_id == @job_id
        next success if lifecycle.policy.expire_if_due?

        at = [ @operation.lease_expires_at, @operation.execution_deadline ].min
        if at > Time.current
          lifecycle.schedule_recovery
          next success
        end
        next success if (at - @expected_at).abs > 0.001

        lifecycle.fail_execution(@operation.execution_deadline <= Time.current ? "execution_timeout" : "lease_expired", retryable: true)
        success
      end
    end
  end
end

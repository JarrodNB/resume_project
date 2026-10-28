# Renew an exact chat lease; accepted attempts may finish their accounting without new work.
module Chat
  class RenewClaimService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:, attempt_id:, claim_generation:)
      @operation, @attempt_id, @generation = operation, attempt_id, claim_generation
    end

    def call
      with_operation_lock do
        finished = @operation.accepted? || (@operation.failure_code.present? && @operation.lease_expires_at &&
          @operation.lease_expires_at > Time.current && @operation.execution_deadline > Time.current)
        next success({ execution_finished: true }) if finished && @operation.attempt_id == @attempt_id && @operation.claim_generation == @generation
        next failure("Claim is stale or expired") unless current_claim?
        @operation.update!(lease_expires_at: [LEASE.from_now, @operation.execution_deadline].min)
        ScheduleRecoveryService.call(operation: @operation)
        success({ lease_expires_at: @operation.lease_expires_at, execution_deadline: @operation.execution_deadline })
      end
    end
  end
end

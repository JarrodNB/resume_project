# Renew an exact lease without extending the absolute deadline (shared by chat and interviews).
# A matching finished execution gets a read-only receipt so its final usage can still be recorded.
module AiExecutions
  class RenewClaimService < ApplicationService
    def initialize(operation:, attempt_id:, claim_generation:, checkpoint: nil)
      @operation, @attempt_id, @generation, @checkpoint = operation, attempt_id, claim_generation, checkpoint
    end

    def call
      lifecycle = OperationLifecycle.for(@operation)
      policy = lifecycle.policy
      return failure("Invalid checkpoint") if @checkpoint && !policy.checkpoints&.include?(@checkpoint)

      lifecycle.with_lock do
        next success({ execution_finished: true }) if finished_receipt?(policy)
        next failure("Claim is stale or expired") unless lifecycle.current_claim?(@attempt_id, @generation)

        attributes = { lease_expires_at: [ OperationLifecycle::LEASE.from_now, @operation.execution_deadline ].min }
        attributes[:checkpoint] = @checkpoint || @operation.checkpoint if policy.checkpoints
        @operation.update!(attributes)
        lifecycle.schedule_recovery
        success({ lease_expires_at: @operation.lease_expires_at, execution_deadline: @operation.execution_deadline })
      end
    end

    private

    def finished_receipt?(policy)
      policy.finished_state? && @operation.attempt_id == @attempt_id && @operation.claim_generation == @generation &&
        policy.receipt_allowed?(attempt_id: @attempt_id, checkpoint: @checkpoint)
    end
  end
end

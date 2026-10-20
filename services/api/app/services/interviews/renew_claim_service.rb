# Renews a current lease without extending its absolute execution deadline. Checkpoints
# describe progress only; they cannot replace saved dialogue or canonical model history.
module Interviews
  class RenewClaimService < ApplicationService
    include ExecutionPolicy
    CHECKPOINTS = %w[recording_validated transcribed screened interviewer_finished speech_started].freeze

    def initialize(operation:, attempt_id:, claim_generation:, checkpoint: nil)
      @operation, @attempt_id, @generation, @checkpoint = operation, attempt_id, claim_generation, checkpoint
    end

    def call
      return failure("Invalid checkpoint") if @checkpoint && !CHECKPOINTS.include?(@checkpoint)

      with_operation_lock do
        next failure("Claim is stale or expired") unless current_claim?
        @operation.update!(lease_expires_at: [ LEASE.from_now, @operation.execution_deadline ].min,
          checkpoint: @checkpoint || @operation.checkpoint)
        success({ lease_expires_at: @operation.lease_expires_at, execution_deadline: @operation.execution_deadline })
      end
    end
  end
end

# Renews a current lease without extending its absolute execution deadline. Checkpoints
# describe progress only; they cannot replace saved dialogue or canonical model history.
# A matching finished execution receives a read-only receipt so its final usage can finish.
module Interviews
  class RenewClaimService < ApplicationService
    include ExecutionPolicy
    CHECKPOINTS = %w[recording_validated transcribed screened interviewer_finished speech_started].freeze

    def initialize(operation:, attempt_id:, claim_generation:, checkpoint: nil)
      @operation, @attempt_id, @generation, @checkpoint = operation, attempt_id, claim_generation, checkpoint
    end

    def call
      return failure("Invalid checkpoint") if @checkpoint && !CHECKPOINTS.include?(@checkpoint)

      with_operation_lock do |interview|
        next success({ execution_finished: true }) if finished_execution?(interview)

        next failure("Claim is stale or expired") unless current_claim?
        @operation.update!(lease_expires_at: [ LEASE.from_now, @operation.execution_deadline ].min,
          checkpoint: @checkpoint || @operation.checkpoint)
        ScheduleRecoveryService.call(operation: @operation)
        success({ lease_expires_at: @operation.lease_expires_at, execution_deadline: @operation.execution_deadline })
      end
    end

    private

    def finished_execution?(interview)
      # Accepted results are final. Failure receipts still require an unexpired
      # lease so recovery after actual lease/deadline loss keeps stopping work.
      finished = @operation.accepted? ||
        ((@operation.failed? || (@operation.pending? && @operation.failure_code.present?)) &&
          @operation.lease_expires_at > Time.current && @operation.execution_deadline > Time.current)
      finished && @attempt_id.present? && @attempt_id == @operation.attempt_id &&
        @generation == @operation.claim_generation && !@checkpoint &&
        !interview.abandoned? && !interview.expired? && interview.expires_at > Time.current
    end
  end
end

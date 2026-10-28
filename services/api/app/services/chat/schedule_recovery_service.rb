# Reuse the shared recovery job with an exact chat lease and generation fence.
module Chat
  class ScheduleRecoveryService < ApplicationService
    def initialize(operation:)
      @operation = operation
    end

    def call
      at = [@operation.lease_expires_at, @operation.execution_deadline].min
      job = AiExecutions::RecoveryJob.new("chat", @operation.id, @operation.attempt_id, @operation.claim_generation, at.iso8601(6))
      job.enqueue(wait_until: at)
      raise ActiveJob::EnqueueError, "AI recovery enqueue failed" unless job.successfully_enqueued?
      @operation.update!(recovery_job_id: job.job_id)
      success(job.job_id)
    end
  end
end

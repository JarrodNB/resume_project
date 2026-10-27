# Commit delivery intent with the operation, then make one optional immediate nudge.
module Interviews
  class ScheduleOperationService < ApplicationService
    def initialize(operation:, nudge: true)
      @operation, @nudge = operation, nudge
    end

    def call
      at = @operation.retry_at || Time.current
      job = AiExecutions::DispatchJob.new("interviews", @operation.id)
      job.enqueue(wait_until: at > Time.current ? at : 1.second.from_now)
      raise ActiveJob::EnqueueError, "AI dispatch enqueue failed" unless job.successfully_enqueued?
      @operation.update!(delivery_job_id: job.job_id)

      if @nudge && at <= Time.current
        id = @operation.id
        ActiveRecord.after_all_transactions_commit do
          AiExecutions::NudgeService.call(feature: "interviews", operation_id: id)
        rescue StandardError
          # Committed fallback remains runnable if a nudge fails after commit.
          Rails.logger.warn("AI execution immediate nudge unavailable")
        end
      end
      success(job.job_id)
    end
  end
end

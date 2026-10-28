# Persist the same shared dispatcher used by interviews before optionally nudging FastAPI.
module Chat
  class ScheduleOperationService < ApplicationService
    def initialize(operation:)
      @operation = operation
    end

    def call
      at = @operation.retry_at || Time.current
      job = AiExecutions::DispatchJob.new("chat", @operation.id)
      job.enqueue(wait_until: at > Time.current ? at : 1.second.from_now)
      raise ActiveJob::EnqueueError, "AI dispatch enqueue failed" unless job.successfully_enqueued?
      @operation.update!(delivery_job_id: job.job_id)
      id = @operation.id
      if at <= Time.current
        ActiveRecord.after_all_transactions_commit do
          AiExecutions::NudgeService.call(feature: "chat", operation_id: id)
        rescue StandardError
          Rails.logger.warn("Chat immediate nudge unavailable; durable delivery retained")
        end
      end
      success(job.job_id)
    end
  end
end

# Description: Repairs tasks that were saved but never sent to SQS (for example the process died
# between commit and send). Tasks waiting at least a minute are sent again; tasks older than the
# in-flight window are failed so the user can retry. Looks only at tasks marked
# awaiting_queue_publish, so interview HTTP work is never touched. Bounded to 100 tasks per run.
# Index:
#   - call: republishes or fails stale unpublished tasks; always succeeds
module AiTasks
  class RepublishUnpublishedTasksService < ApplicationService
    GRACE_PERIOD = 1.minute
    BATCH_SIZE = 100

    def call
      AiTask.queued.where(awaiting_queue_publish: true).where(created_at: ...GRACE_PERIOD.ago)
        .order(:created_at).limit(BATCH_SIZE).pluck(:id).each { |id| repair(id) }
      success
    end

    private

    def repair(id)
      ai_task = AiTask.find_by(id: id)
      return unless ai_task

      # Owner first, then task, matching every other AiTask writer.
      ai_task.user.with_lock do
        ai_task.with_lock do
            next unless ai_task.queued? && ai_task.awaiting_queue_publish

          if ai_task.created_at < AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago
            UpdateTaskService.call(task: ai_task, attributes: { status: "failed", awaiting_queue_publish: false,
              error_message: "Could not queue the task", completed_at: Time.current })
          else
            PublishTaskToQueueService.call(ai_task: ai_task)
          end
        end
      end
    rescue *PublishTaskToQueueService::QUEUE_ERRORS => error
      Rails.logger.error("Could not republish AiTask #{id}: #{error.message}")
    end
  end
end

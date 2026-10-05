# Description: Publishes an existing AiTask again (tailoring requeues the same task per section)
# and tells subscribers it is queued. Does not create a row or re-check the hourly task limit.
# Index:
#   - call: sets status to queued, sends the task message, triggers aiTaskUpdated
module AiTasks
  class RepublishAiTaskService < ApplicationService
    QUEUE_ERRORS = EnqueueAiTaskService::QUEUE_ERRORS

    def initialize(ai_task:)
      @ai_task = ai_task
    end

    # Publishes the task's current input. A task that can't be published is marked failed.
    def call
      @ai_task.update!(status: "queued")
      message = {
        ai_task_id: @ai_task.id,
        user_id: @ai_task.user_id,
        task_type: @ai_task.task_type,
        input: @ai_task.input
      }
      Shoryuken::Client.queues(AI_TASKS_QUEUE_NAME).send_message(message_body: message.to_json)
      ApiSchema.subscriptions.trigger(:ai_task_updated, { id: @ai_task.id }, @ai_task)
      success(@ai_task)
    rescue *QUEUE_ERRORS => error
      Rails.logger.error("Could not republish AiTask #{@ai_task.id}: #{error.message}")
      @ai_task.update!(status: "failed", error_message: "Could not queue the task", completed_at: Time.current)
      failure([ "Could not queue the AI task, please try again" ])
    end
  end
end

# Description: Sends one AiTask's message to the ai_tasks SQS queue and clears its
# awaiting_queue_publish marker. Used right after a task is saved and by the sweep that
# repairs tasks whose first send never happened. A duplicate send is harmless because the
# worker and result handlers are idempotent. Raises the SQS errors in QUEUE_ERRORS to the caller.
# Index:
#   - call: publishes {ai_task_id, user_id, task_type, input}; returns the task
module AiTasks
  class PublishTaskToQueueService < ApplicationService
    QUEUE_ERRORS = [ Aws::SQS::Errors::ServiceError, Seahorse::Client::NetworkingError ].freeze

    def initialize(ai_task:)
      @ai_task = ai_task
    end

    def call
      message = {
        ai_task_id: @ai_task.id,
        user_id: @ai_task.user_id,
        task_type: @ai_task.task_type,
        input: @ai_task.input
      }
      Shoryuken::Client.queues(AI_TASKS_QUEUE_NAME).send_message(message_body: message.to_json)
      @ai_task.update_columns(awaiting_queue_publish: false)
      success(@ai_task)
    end
  end
end

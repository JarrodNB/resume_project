# Description: Creates a queued AiTask and publishes it to the ai_tasks SQS queue for the AI worker.
# Index:
#   - call: saves the task and publishes {ai_task_id, user_id, task_type, input}; returns the task
module AiTasks
  class EnqueueAiTaskService < ApplicationService
    QUEUE_ERRORS = [ Aws::SQS::Errors::ServiceError, Seahorse::Client::NetworkingError ].freeze

    def initialize(user:, task_type:, input: {}, subject: nil)
      @user = user
      @task_type = task_type
      @input = input
      @subject = subject
    end

    # Saves the task, then publishes it. A task that can't be published is marked failed.
    def call
      ai_task = @user.ai_tasks.new(task_type: @task_type, input: @input, subject: @subject)
      return failure(ai_task.errors) unless ai_task.save

      publish(ai_task)
      success(ai_task)
    rescue *QUEUE_ERRORS => error
      Rails.logger.error("Could not publish AiTask #{ai_task.id}: #{error.message}")
      ai_task.update!(status: "failed", error_message: "Could not queue the task", completed_at: Time.current)
      failure([ "Could not queue the AI task, please try again" ])
    end

    private

    # Sends the task message to the ai_tasks queue.
    def publish(ai_task)
      message = {
        ai_task_id: ai_task.id,
        user_id: ai_task.user_id,
        task_type: ai_task.task_type,
        input: ai_task.input
      }
      Shoryuken::Client.queues(AI_TASKS_QUEUE_NAME).send_message(message_body: message.to_json)
    end
  end
end

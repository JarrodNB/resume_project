# Description: Creates a queued AiTask and publishes it to the ai_tasks SQS queue for the AI worker,
# unless the user has reached an AI usage limit (AiUsage::CheckAiTaskAllowanceService).
# Index:
#   - call: saves the task and publishes {schema_version, ai_task_id, user_id, task_type}; returns the task
module AiTasks
  class EnqueueAiTaskService < ApplicationService
    QUEUE_ERRORS = PublishTaskToQueueService::QUEUE_ERRORS

    # @param source_file [ActiveStorage::Blob, nil] an uploaded file the task reads, attached
    #   to the task so it stays linked to the upload
    # @param prepare_task [#call, nil] prepares input/subject under the user lock after allowance
    #   checks, returning a ServiceResult; queue publication occurs after the lock commits
    # @param resolve_existing [#call, nil] checks for reusable work under the user lock before
    #   allowance checks. Return a ServiceResult to stop (without publishing), or nil to enqueue.
    def initialize(user:, task_type:, input: {}, subject: nil, source_file: nil, prepare_task: nil, resolve_existing: nil)
      @user = user
      @task_type = task_type
      @input = input
      @subject = subject
      @source_file = source_file
      @prepare_task = prepare_task
      @resolve_existing = resolve_existing
    end

    # Checks the user's AI usage limits, saves the task, then publishes it. A task that can't be
    # published is marked failed.
    def call
      @resolved_existing = false
      result = create_task_within_limits
      return result unless result.success?
      return result if @resolved_existing

      publish_or_fail(result.value)
    end

    private

    # Checks the limits and saves the task under a lock on the user's row, so two concurrent
    # requests can't both pass the check. Publishing happens after the lock is released.
    def create_task_within_limits
      @user.with_lock do
        if @resolve_existing && (existing = @resolve_existing.call)
          @resolved_existing = true
          next existing
        end
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @user)
        next allowance unless allowance.success?

        ai_task = @user.ai_tasks.new(task_type: @task_type, input: @input, subject: @subject,
                                     awaiting_queue_publish: true)
        if @prepare_task
          preparation = @prepare_task.call(ai_task)
          next preparation unless preparation.success?
        end
        ai_task.source_file.attach(@source_file) if @source_file
        ai_task.save ? success(ai_task) : failure(ai_task.errors)
      end
    end

    # Publishes the saved task; if the queue is unreachable, marks the task failed instead.
    def publish_or_fail(ai_task)
      PublishTaskToQueueService.call(ai_task: ai_task)
      success(ai_task)
    rescue *QUEUE_ERRORS => error
      Rails.logger.error("Could not publish AiTask #{ai_task.id}: #{error.message}")
      UpdateTaskService.call(task: ai_task, attributes: { status: "failed", awaiting_queue_publish: false, error_message: "Could not queue the task", completed_at: Time.current })
      failure([ "Could not queue the AI task, please try again" ])
    end
  end
end

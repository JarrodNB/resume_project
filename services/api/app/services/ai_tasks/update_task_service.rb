# Updates a task and saves each new terminal outcome in the same transaction.
# Owner-first locks serialize outcome cursors through commit. Callers already holding
# locks must acquire the owner before the task; never call this while holding only a task lock.
module AiTasks
  class UpdateTaskService < ApplicationService
    def initialize(task:, attributes:)
      @task = task
      @attributes = attributes
    end

    def call
      @task.user.with_lock do
        @task.with_lock do
          was_finished = @task.finished?
          @task.update!(@attributes)
          if @task.finished? && !was_finished
            outcome = @task.user.ai_task_outcomes.create!(ai_task: @task, task_type: @task.task_type,
              status: @task.status, completed_at: @task.completed_at || Time.current)
            ActiveRecord.after_all_transactions_commit { PublishTaskOutcomeService.call(outcome: outcome) }
          end
        end
      end
      success(@task)
    end
  end
end

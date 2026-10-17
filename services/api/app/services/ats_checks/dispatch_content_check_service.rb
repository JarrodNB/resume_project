# Retry publication of the same durable task; never create duplicate charges on dispatch retry.
module AtsChecks
  class DispatchContentCheckService < ApplicationService
    def initialize(run:)
      @run = run
    end

    def call
      task = nil
      @run.user.with_lock do
        @run.with_lock do
          return success(@run) unless %w[pending queued].include?(@run.status)
          task = @run.ai_task
          unless task
            allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @run.user)
            unless allowance.success?
              @run.update!(status: "failed", error_message: allowance.errors.join(", "))
              return failure(allowance.errors)
            end
            input = @run.attributes.slice("content_fingerprint", "job_fingerprint", "rubric_version")
                        .merge("run_id" => @run.id, "resume_id" => @run.resume_id)
            task = @run.user.ai_tasks.create!(task_type: "check_resume_content", input: input, subject: @run.resume)
            @run.update!(ai_task: task)
          end
        end
      end
      message = { ai_task_id: task.id, user_id: task.user_id, task_type: task.task_type, input: task.input }
      Shoryuken::Client.queues(AI_TASKS_QUEUE_NAME).send_message(message_body: message.to_json)
      @run.with_lock { @run.update!(status: "queued", error_message: nil) if @run.status == "pending" }
      success(@run)
    rescue *AiTasks::EnqueueAiTaskService::QUEUE_ERRORS
      @run.update_columns(error_message: "Could not queue the check yet. Retrying delivery.")
      raise
    ensure
      NotifyReportService.call(resume: @run.resume) if @run.persisted?
    end
  end
end

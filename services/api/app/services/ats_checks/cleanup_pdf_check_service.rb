# Expire abandoned inspection work and delete its temporary upload, safely on retries.
module AtsChecks
  class CleanupPdfCheckService < ApplicationService
    def initialize(ai_task:)
      @task = ai_task
    end
    def call
      unless @task.finished?
        AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => @task.id, "status" => "failed", "error_message" => "PDF inspection expired. Export again to retry." })
      end
      @task.source_file.purge if @task.source_file.attached?
      success(@task)
    end
  end
end

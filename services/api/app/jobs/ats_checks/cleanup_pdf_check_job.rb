# Recover terminal or abandoned exports through the shared cleanup service.
module AtsChecks
  class CleanupPdfCheckJob < ApplicationJob
    queue_as :default
    def perform(task_id)
      task = AiTask.find_by(id: task_id, task_type: "check_resume_pdf")
      CleanupPdfCheckService.call(ai_task: task) if task
    end
  end
end

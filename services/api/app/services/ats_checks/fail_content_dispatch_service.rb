# Finish exhausted dispatch through the shared result lifecycle, preserving existing accounting.
module AtsChecks
  class FailContentDispatchService < ApplicationService
    MESSAGE = "Could not queue the check. Please retry.".freeze

    def initialize(run:)
      @run = run
    end

    def call
      @run.user.with_lock do
        @run.reload
        return success(@run) unless %w[pending queued].include?(@run.status)

        if (task = @run.ai_task)
          # This is a delivery failure, not a new provider execution or usage report.
          # Preserve any real charges already recorded before delivery exhausted.
          usage = task.attributes.slice(*AiTasks::ApplyAiResultService::USAGE_COLUMNS)
          result = AiTasks::ApplyAiResultService.call(message: {
            "ai_task_id" => task.id, "status" => "failed", "error_message" => MESSAGE, "usage" => [ usage ]
          })
          return result unless result.success?
        else
          @run.with_lock { @run.update!(status: "failed", error_message: MESSAGE) if @run.status == "pending" }
          NotifyReportService.call(resume: @run.resume)
        end
        success(@run.reload)
      end
    end
  end
end

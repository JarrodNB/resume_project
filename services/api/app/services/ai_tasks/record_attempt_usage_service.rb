# Description: Adds each execution's known costs exactly once, even for finished or stale tasks.
# Index:
#   - call: persists an immutable usage report as entry rows and moves the locked task's
#     known totals by the change, so a reopened incomplete report replaces its old rows
module AiTasks
  class RecordAttemptUsageService < ApplicationService
    COLUMNS = AiUsage::AttemptEntries::TOTAL_FIELDS

    # Receives the task already locked by result application.
    def initialize(ai_task:, message:)
      @ai_task = ai_task
      @message = message
    end

    # Resolves unfinished markers once; separately billed executions have separate identities.
    def call
      attempt_id = @message.fetch("attempt_id")
      report = @ai_task.ai_usage_attempts.find_by(attempt_id: attempt_id)
      return success(false) if report&.finalized?
      finalized = @message["attempt_finished"] != false
      return success(false) if report && !finalized

      entries = finalized ? Array(@message["usage"]) : []
      report ||= AiUsageAttempt.new(ai_task: @ai_task, attempt_id: attempt_id)
      report.update!(finalized: finalized,
                     incomplete: !finalized || @message["usage_incomplete"] == true ||
                       entries.any? { |entry| entry["cost_microdollars"].nil? })
      AiUsage::AttemptEntries.replace(report, entries, ai_task: @ai_task)
      success(true)
    end
  end
end

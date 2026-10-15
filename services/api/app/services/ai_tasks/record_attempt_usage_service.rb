# Description: Adds each execution's known costs exactly once, even for finished or stale tasks.
# Index:
#   - call: persists an immutable usage report and updates the locked task's known totals
module AiTasks
  class RecordAttemptUsageService < ApplicationService
    COLUMNS = %w[input_tokens cached_input_tokens output_tokens cost_microdollars].freeze

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
      report.update!(usage: entries, finalized: finalized,
                     incomplete: !finalized || @message["usage_incomplete"] == true)
      totals = COLUMNS.index_with do |column|
        @ai_task.public_send(column) + entries.sum { |entry| entry.fetch(column, 0).to_i }
      end
      @ai_task.update!(totals)
      success(true)
    end
  end
end

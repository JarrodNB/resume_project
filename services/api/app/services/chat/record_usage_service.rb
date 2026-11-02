# Finalize independently billed provider receipts even after the operation is stale or accepted.
# Finalized reports are immutable; missing usage stays unknown rather than becoming zero.
module Chat
  class RecordUsageService < ApplicationService
    include ExecutionPolicy
    COLUMNS = AiTasks::RecordAttemptUsageService::COLUMNS
    def initialize(operation:, attempt_id:, usage:, incomplete: false, observation_id: nil)
      @operation, @attempt_id, @usage, @incomplete, @observation_id = operation, attempt_id, usage, incomplete, observation_id
    end
    def call
      return failure("Invalid usage report") unless [true, false].include?(@incomplete) && @usage.is_a?(Array) && @usage.length <= 1 &&
        (!@incomplete || @usage.empty?) && @usage.all? { |entry| entry.is_a?(Hash) && (entry.keys - COLUMNS).empty? &&
          entry.values.all? { |value| value.is_a?(Integer) && value.between?(0, 1_000_000_000_000) } }
      with_operation_lock do
        execution = @operation.execution_attempts.find_by(attempt_id: @attempt_id)
        next failure("Unknown execution") unless execution
        if @observation_id
          observation = execution.provider_attempts.find_by(observation_id: @observation_id)
          next failure("Unknown provider attempt") unless observation
          next failure("Known usage requires explicit cost") unless @incomplete || (@usage.length == 1 && @usage.first.key?("cost_microdollars"))
          entries = @usage.map { |entry| entry.merge(observation.attributes.slice("stage", "provider", "model")) }
        else
          next failure("Execution completion cannot report provider charges") unless @usage.empty?
          entries = []
        end
        identity = @observation_id || @attempt_id
        report = @operation.ai_task.ai_usage_attempts.find_by!(attempt_id: identity)
        next failure("Provider usage conflicts") if report.finalized? && (!AiUsage::AttemptEntries.matches?(report, entries) ||report.incomplete? != @incomplete)
        result = AiTasks::RecordAttemptUsageService.call(ai_task: @operation.ai_task,
          message: { "attempt_id" => identity, "usage" => entries, "usage_incomplete" => @incomplete })
        success({ recorded: result.value })
      end
    end
  end
end

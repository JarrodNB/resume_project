# Finalizes one persisted provider call, including calls from stale executions. Finishing
# the execution marker itself carries no charges, so final summaries cannot count twice.
module Interviews
  class RecordUsageService < ApplicationService
    include ExecutionPolicy
    COLUMNS = (AiTasks::RecordAttemptUsageService::COLUMNS + %w[audio_milliseconds characters]).freeze

    def initialize(operation:, attempt_id:, usage:, incomplete: false, observation_id: nil)
      @operation, @attempt_id, @usage, @incomplete, @observation_id = operation, attempt_id, usage, incomplete, observation_id
    end

    def call
      return failure("Invalid usage report") unless valid_usage?

      with_operation_lock do
        execution = @operation.execution_attempts.find_by(attempt_id: @attempt_id)
        next failure("Unknown execution") unless execution
        if @observation_id
          observation = execution.provider_attempts.find_by(observation_id: @observation_id)
          next failure("Unknown provider attempt") unless observation
          next failure("Known usage requires explicit cost") if !@incomplete && (@usage.length != 1 || !@usage.first.key?("cost_microdollars"))
          entries = @usage.map { |entry| entry.merge(observation.attributes.slice("stage", "provider", "model")) }
        else
          next failure("Execution completion cannot report provider charges") unless @usage.empty?
          entries = []
        end
        AiTasks::RecordAttemptUsageService.call(ai_task: @operation.ai_task,
          message: { "attempt_id" => @observation_id || @attempt_id, "usage" => entries, "usage_incomplete" => @incomplete })
      end
    end

    private

    def valid_usage?
      [ true, false ].include?(@incomplete) && @usage.is_a?(Array) && @usage.length <= 1 && @usage.all? do |entry|
        entry.is_a?(Hash) && (entry.keys - COLUMNS).empty? && entry.values.all? { |value| value.is_a?(Integer) && value.between?(0, 1_000_000_000_000) }
      end
    end
  end
end

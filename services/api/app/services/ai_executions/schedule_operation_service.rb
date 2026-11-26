# Queue delivery of a chat or interview operation to the AI runtime (shared by both features).
# Commits the dispatch intent with the operation, then makes one optional immediate nudge.
module AiExecutions
  class ScheduleOperationService < ApplicationService
    def initialize(operation:, nudge: true)
      @operation, @nudge = operation, nudge
    end

    def call
      success(OperationLifecycle.for(@operation).schedule(nudge: @nudge))
    end
  end
end

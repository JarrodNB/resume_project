# Save the watchdog job for an operation's current lease (shared by chat and interviews).
module AiExecutions
  class ScheduleRecoveryService < ApplicationService
    def initialize(operation:)
      @operation = operation
    end

    def call
      success(OperationLifecycle.for(@operation).schedule_recovery)
    end
  end
end

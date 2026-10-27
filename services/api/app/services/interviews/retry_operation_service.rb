# Opens another bounded recovery cycle for failed work. Accepted dialogue cannot be
# regenerated, and an expired recording or exhausted execution allowance stays terminal.
module Interviews
  class RetryOperationService < ApplicationService
    include ExecutionPolicy

    def initialize(operation:)
      @operation = operation
    end

    def call
      with_operation_lock do |interview|
        eligibility = RetryEligibilityService.call(operation: @operation, lock_recording: true)
        next eligibility unless eligibility.success?
        allowance = CheckOperationAllowanceService.call(operation: @operation)
        next allowance unless allowance.success?
        @operation.update!(status: "pending", cycle_execution_count: 0, retry_at: Time.current, failure_code: nil)
        @operation.ai_task&.update!(status: "queued", completed_at: nil, error_message: nil)
        ScheduleOperationService.call(operation: @operation)
        success(@operation)
      end
    end
  end
end

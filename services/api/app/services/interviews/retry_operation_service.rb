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
        lifecycle.reopen_for_retry!(retry_at: Time.current)
        success(@operation)
      end
    end
  end
end

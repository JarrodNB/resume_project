# Returns the canonical receipt after an ambiguous callback without returning private
# model history, recordings, or the current execution's claim credentials.
module Interviews
  class OperationStatusService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:)
      @operation = operation
    end

    def call
      with_operation_lock do |interview|
        expire_operation(interview)
        success({ operation_id: @operation.id, status: @operation.status, accepted_result: @operation.accepted_result,
          execution_count: @operation.execution_count, retry_at: @operation.retry_at, failure_code: @operation.failure_code })
      end
    end
  end
end

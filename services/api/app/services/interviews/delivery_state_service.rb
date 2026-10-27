# Read delivery authority under the same locks used by claims and acceptance.
module Interviews
  class DeliveryStateService < ApplicationService
    include ExecutionPolicy

    def initialize(operation:, delivery_job_id: nil)
      @operation, @delivery_job_id = operation, delivery_job_id
    end

    def call
      with_operation_lock do |interview|
        next success({ delivered: true }) if @delivery_job_id && @delivery_job_id != @operation.delivery_job_id
        expire_operation(interview)
        terminal = @operation.accepted? || @operation.failed? || @operation.expired?
        recovery = @operation.running? && @operation.recovery_job_id.present? &&
          @operation.lease_expires_at > Time.current && @operation.execution_deadline > Time.current
        success({ delivered: terminal || recovery, retry_at: @operation.retry_at })
      end
    end
  end
end

# Surface exhausted infrastructure recovery without replacing accepted dialogue.
module Interviews
  class StopDeliveryService < ApplicationService
    include ExecutionPolicy

    def initialize(operation:, delivery_job_id: nil, attempt_id: nil, generation: nil, recovery_job_id: nil)
      @operation, @delivery_job_id = operation, delivery_job_id
      @attempt_id, @generation, @recovery_job_id = attempt_id, generation, recovery_job_id
    end

    def call
      with_operation_lock do |interview|
        delivery = @delivery_job_id && @operation.delivery_job_id == @delivery_job_id && @operation.pending?
        recovery = @recovery_job_id && @operation.recovery_job_id == @recovery_job_id &&
          @operation.attempt_id == @attempt_id && @operation.claim_generation == @generation &&
          @operation.running? && [ @operation.lease_expires_at, @operation.execution_deadline ].min <= Time.current
        next success unless delivery || recovery
        next success if expire_operation(interview)

        @operation.update!(status: "failed", failure_code: "dependency_unavailable", retry_at: nil,
          retry_expires_at: @operation.retry_expires_at || interview.expires_at)
        AiTasks::UpdateTaskService.call(task: @operation.ai_task, attributes: { status: "failed",
          completed_at: Time.current, error_message: "dependency_unavailable" }) if @operation.ai_task
        success
      end
    end
  end
end

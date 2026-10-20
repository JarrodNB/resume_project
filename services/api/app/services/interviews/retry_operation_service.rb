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
        next failure("Operation cannot be retried") unless @operation.failed? && @operation.execution_count < 6 &&
          @operation.retry_expires_at && @operation.retry_expires_at > Time.current && interview.expires_at > Time.current &&
          !%w[invalid_recording screening_blocked].include?(@operation.failure_code)
        if @operation.turn?
          next failure("Interview revision is stale") unless interview.active? && interview.revision == @operation.expected_revision
          next failure("An answer is already processing") if interview.operations.turn.where(status: %w[pending running]).exists?
        end
        next failure("Media expired") if @operation.speech? && interview.completed_at && interview.completed_at <= 1.hour.ago
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: interview.user, existing_task: @operation.ai_task)
        next allowance unless allowance.success?
        @operation.update!(status: "pending", cycle_execution_count: 0, retry_at: Time.current, failure_code: nil)
        @operation.ai_task&.update!(status: "queued", completed_at: nil, error_message: nil)
        success(@operation)
      end
    end
  end
end

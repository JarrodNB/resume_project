# Reserves a unique execution, its recovery clock and unknown-cost marker before
# returning owner-derived context. Retrying a logical operation never publishes SQS.
module Interviews
  class ClaimOperationService < ApplicationService
    include ExecutionPolicy

    def initialize(operation:)
      @operation = operation
    end

    # @return [ServiceResult<Hash>] claim identity and canonical execution inputs
    def call
      with_operation_lock do |interview|
        next failure("Media expired") if expire_operation(interview)
        next failure("Interview expired") if interview.expires_at <= Time.current || interview.expired?
        if @operation.turn?
          next failure("Interview revision is stale") unless interview.active? && interview.revision == @operation.expected_revision &&
            interview.current_question_position == @operation.question.position
        end
        expiry = @operation.turn? ? @operation.created_at + 1.hour : (interview.completed_at ? interview.completed_at + 1.hour : interview.expires_at)
        if @operation.running?
          next failure("Operation already claimed") if @operation.lease_expires_at > Time.current && @operation.execution_deadline > Time.current
          fail_execution(@operation.execution_deadline <= Time.current ? "execution_timeout" : "lease_expired", retryable: true)
          next failure("Recovery scheduled")
        end
        next failure("Operation is not eligible") unless @operation.pending? && (!@operation.retry_at || @operation.retry_at <= Time.current)
        next failure("Recording expired") if @operation.turn? && @operation.created_at <= 1.hour.ago
        next failure("Execution limit reached") if @operation.execution_count >= 6 || @operation.cycle_execution_count >= 3
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: interview.user, existing_task: @operation.ai_task)
        next allowance unless allowance.success?
        unless @operation.ai_task
          @operation.ai_task = interview.user.ai_tasks.create!(task_type: "interview_#{@operation.kind}", subject: interview,
            input: { operation_id: @operation.id })
        end
        attempt_id = SecureRandom.uuid
        @operation.update!(status: "running", attempt_id: attempt_id, claim_generation: @operation.claim_generation + 1,
          execution_count: @operation.execution_count + 1, cycle_execution_count: @operation.cycle_execution_count + 1,
          lease_expires_at: LEASE.from_now, execution_deadline: DEADLINE.from_now, retry_at: nil,
          retry_expires_at: @operation.retry_expires_at || expiry,
          failure_code: nil, checkpoint: nil)
        @operation.execution_attempts.create!(attempt_id: attempt_id, claim_generation: @operation.claim_generation)
        AiTasks::RecordAttemptUsageService.call(ai_task: @operation.ai_task,
          message: { "attempt_id" => attempt_id, "attempt_finished" => false })
        @operation.ai_task.update!(status: "queued", completed_at: nil, error_message: nil)
        payload = if @operation.speech?
          { text: @operation.message.content, message_id: @operation.message_id }
        else
          { recording_id: @operation.recording_id, expected_revision: @operation.expected_revision,
            question: @operation.question.content, model_history: @operation.question.model_history,
            history_version: @operation.question.history_version, fixture_context: interview.fixture_context }
        end
        success({ operation_id: @operation.id, kind: @operation.kind, attempt_id: attempt_id,
          claim_generation: @operation.claim_generation, lease_expires_at: @operation.lease_expires_at,
          execution_deadline: @operation.execution_deadline, payload: payload })
      end
    end
  end
end

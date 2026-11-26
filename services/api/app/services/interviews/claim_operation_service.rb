# Reserves a unique execution, its recovery clock and unknown-cost marker before
# returning owner-derived context. Admission failures require an explicit retry and
# reserve no execution or provider attempt. Retrying never publishes SQS.
# The attempt, lease and budget rules are shared (`AiExecutions::OperationLifecycle`); this
# service adds the interview checks: expiry, abandonment, revision, recording and allowance.
module Interviews
  class ClaimOperationService < ApplicationService
    include ExecutionPolicy

    def initialize(operation:, execution_mode: "fake")
      @operation, @execution_mode = operation, execution_mode
    end

    # @return [ServiceResult<Hash>] claim identity and canonical execution inputs
    def call
      return failure("Interview execution mode unavailable") unless ExecutionConfiguration::PRESETS.key?(@execution_mode)

      with_operation_lock do |interview|
        next failure("Interview abandoned") if interview.abandoned?
        next failure("Interview execution mode mismatch") unless interview.execution_mode == @execution_mode
        next failure("Provider speech is disabled") if @operation.speech? && !SpeechPlayback.provider?(interview)
        next failure("Media expired") if expire_operation(interview)
        next failure("Interview expired") if interview.expires_at <= Time.current || interview.expired?
        next failure("Preparation is no longer active") if @operation.preparation? && !interview.preparing?
        if @operation.turn? || @operation.transcription?
          next failure("Interview revision is stale") unless interview.active? && interview.revision == @operation.expected_revision &&
            interview.current_question_position == @operation.question.position
          unless @operation.text_only?
            recording = InterviewSessionMedia.lock.find_by(id: @operation.recording_id, interview_session: interview,
            question_id: @operation.question_id, kind: "recording", status: "ready")
            next failure("Recording unavailable or expired") unless recording && recording.expires_at > Time.current
          end
          next failure("Reviewed answer unavailable") if @operation.text_only? && @operation.candidate_transcript.blank?
        end
        expiry = lifecycle.policy.work_expiry
        running_error = lifecycle.running_claim_error
        next failure(running_error) if running_error
        next failure("Operation is not eligible") unless lifecycle.pending_and_due?
        next failure("Recording expired") if (@operation.turn? || @operation.transcription?) && @operation.created_at <= 1.hour.ago
        next failure("Execution limit reached") if lifecycle.executions_exhausted?
        allowance = CheckOperationAllowanceService.call(operation: @operation, create_task: true)
        unless allowance.success?
          reject_allowance(expiry: expiry, allowance: allowance)
          next allowance
        end
        unless @operation.ai_task
          @operation.ai_task = interview.user.ai_tasks.create!(counts_toward_trial_budget: AiUsage::SiteDailySpend.counts_user?(interview.user), task_type: "interview_#{@operation.kind}", subject: interview,
            input: { operation_id: @operation.id })
        end
        attempt_id = lifecycle.reserve_attempt!(retry_expires_at: @operation.retry_expires_at || expiry, checkpoint: nil)
        payload = { version: 1, interview_id: interview.id, user_id: interview.user_id,
          setup: SetupConfiguration.for(interview) }
        success({ execution_mode: interview.execution_mode, execution_config: interview.execution_config, operation_id: @operation.id, kind: @operation.kind, attempt_id: attempt_id,
          claim_generation: @operation.claim_generation, lease_expires_at: @operation.lease_expires_at,
          execution_deadline: @operation.execution_deadline, payload: payload })
      end
    end
  end
end

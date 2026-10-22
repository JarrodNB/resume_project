# Reserves a unique execution, its recovery clock and unknown-cost marker before
# returning owner-derived context. Admission failures require an explicit retry and
# reserve no execution or provider attempt. Retrying never publishes SQS.
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
        expiry = if @operation.text_only?
          [ @operation.created_at + 1.hour, interview.expires_at ].min
        elsif @operation.turn? || @operation.transcription?
          recording.expires_at
        else
          interview.completed_at ? interview.completed_at + 1.hour : interview.expires_at
        end
        if @operation.running?
          next failure("Operation already claimed") if @operation.lease_expires_at > Time.current && @operation.execution_deadline > Time.current
          fail_execution(@operation.execution_deadline <= Time.current ? "execution_timeout" : "lease_expired", retryable: true)
          next failure("Recovery scheduled")
        end
        next failure("Operation is not eligible") unless @operation.pending? && (!@operation.retry_at || @operation.retry_at <= Time.current)
        next failure("Recording expired") if (@operation.turn? || @operation.transcription?) && @operation.created_at <= 1.hour.ago
        next failure("Execution limit reached") if @operation.execution_count >= 6 || @operation.cycle_execution_count >= 3
        allowance = CheckOperationAllowanceService.call(operation: @operation, create_task: true)
        unless allowance.success?
          reject_allowance(expiry: expiry)
          next allowance
        end
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
        if interview.frozen_context.present? && !@operation.speech? && !@operation.transcription?
          context = FrozenLibraryScreening.hydrate(interview)
          interview.update!(frozen_context: context) if context != interview.frozen_context
        end
        payload = if @operation.speech?
          { text: MessageText.spoken_content(@operation.message), message_id: @operation.message_id }
        elsif @operation.transcription?
          { recording_id: @operation.recording_id }
        elsif @operation.preparation?
          { frozen_context: interview.frozen_context }
        else
          { candidate_transcript: @operation.candidate_transcript, transcription_mode: @operation.transcription_mode,
            recording_id: @operation.recording_id, expected_revision: @operation.expected_revision,
            question: @operation.question.content, model_history: @operation.question.model_history,
            history_version: @operation.question.history_version,
            current_dialogue: interview.messages.where(question: @operation.question, kind: %w[opening answer follow_up])
              .order(:position).map { |message| { kind: message.kind, content: MessageText.spoken_content(message) } },
            earlier_dialogue: EarlierDialogue.build(interview, before_position: @operation.question.position) }.merge(
              interview.frozen_context.present? ?
                { interview_context: { version: 1, personal_evidence: interview.frozen_context, fictional_role: interview.prepared_role } } :
                { fixture_context: interview.fixture_context })
        end
        success({ execution_mode: interview.execution_mode, execution_config: interview.execution_config, operation_id: @operation.id, kind: @operation.kind, attempt_id: attempt_id,
          claim_generation: @operation.claim_generation, lease_expires_at: @operation.lease_expires_at,
          execution_deadline: @operation.execution_deadline, payload: payload })
      end
    end
  end
end

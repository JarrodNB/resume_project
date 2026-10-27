# Reserves owned complete-audio transcription for review, without submitting an answer.
# The sealed recording is read only by a bounded worker claim; repeats share one operation.
module Interviews
  class StartRecordedTranscriptionService < ApplicationService
    def initialize(interview:, question_id:, expected_revision:, recording_id:)
      @interview, @question_id, @revision, @recording_id = interview, question_id, expected_revision, recording_id
    end

    def call
      uuid = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/
      return failure("Invalid capture") unless @revision.is_a?(Integer) && @revision >= 0 &&
        [ @question_id, @recording_id ].all? { |id| id.is_a?(String) && id.match?(uuid) }

      @interview.user.with_lock do
        @interview.lock!
        next failure("Interview is not active") unless @interview.active? && @interview.expires_at > Time.current
        next failure("Interview revision is stale") unless @revision == @interview.revision
        question = @interview.questions.find_by(id: @question_id, position: @interview.current_question_position)
        next failure("Question is not current") unless question
        recording = InterviewSessionMedia.lock.find_by(id: @recording_id, interview_session: @interview, question: question, kind: "recording", status: "ready")
        next failure("Recording unavailable or expired") unless recording && recording.expires_at > Time.current
        existing = @interview.operations.transcription.find_by(recording_id: recording.id)
        next success(existing) if existing
        next failure("An answer is already processing") if @interview.operations.turn.where(status: %w[pending running]).exists?
        next failure("A transcription is already active") if @interview.operations.transcription.where(status: %w[pending running]).exists?
        next failure("This question reached its capture limit") if @interview.operations.transcription.where(question: question).count >= 6
        root = @interview.operations.preparation.first&.ai_task
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @interview.user, existing_task: root, interview: true)
        next allowance unless allowance.success?
        operation = @interview.operations.create!(kind: "transcription", question: question, expected_revision: @revision, recording_id: recording.id)
        ScheduleOperationService.call(operation: operation)
        success(operation)
      end
    end
  end
end

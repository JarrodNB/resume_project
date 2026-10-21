# Reads the same bounded retry rules used by the retry action and public snapshot.
# The action requests a recording lock while holding its lifecycle locks; snapshots
# only read eligibility, which remains a hint until the action rechecks it.
module Interviews
  class RetryEligibilityService < ApplicationService
    def initialize(operation:, lock_recording: false)
      @operation, @lock_recording = operation, lock_recording
    end

    def call
      interview = @operation.interview_session
      return failure("Interview abandoned") if interview.abandoned?
      return failure("Preparation is no longer active") if @operation.preparation? && !interview.preparing?
      return failure("Operation cannot be retried") unless @operation.failed? && @operation.execution_count < 6 &&
        @operation.retry_expires_at && @operation.retry_expires_at > Time.current && interview.expires_at > Time.current &&
        !%w[invalid_recording transcript_too_long empty_audio audio_too_large audio_too_long context_limit screening_blocked].include?(@operation.failure_code)
      if @operation.turn?
        return failure("Interview revision is stale") unless interview.active? && interview.revision == @operation.expected_revision
        return failure("An answer is already processing") if interview.operations.turn.where(status: %w[pending running]).exists?
        recordings = InterviewSessionMedia.where(id: @operation.recording_id, interview_session: interview,
          question_id: @operation.question_id, kind: "recording", status: "ready")
        recordings = recordings.lock if @lock_recording
        recording = recordings.first
        return failure("Recording unavailable or expired") unless recording && recording.expires_at > Time.current
      end
      return failure("Media expired") if @operation.speech? && interview.completed_at && interview.completed_at <= 1.hour.ago
      success(nil)
    end
  end
end

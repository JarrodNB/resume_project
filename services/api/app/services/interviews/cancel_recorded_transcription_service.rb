# Fences an owned review capture, scrubs its text and releases private audio for cleanup.
# Usage callbacks remain valid for already-started provider attempts.
module Interviews
  class CancelRecordedTranscriptionService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:)
      @operation = operation
    end

    def call
      with_operation_lock do |interview|
        next failure("Not transcription work") unless @operation.transcription?
        @operation.update!(status: "expired", accepted_result: {}, retry_at: nil, failure_code: "capture_cancelled")
        @operation.ai_task&.update!(status: "failed", completed_at: Time.current, error_message: "capture_cancelled")
        InterviewSessionMedia.where(id: @operation.recording_id, interview_session: interview, kind: "recording").update_all(expires_at: Time.current)
        success(@operation)
      end
    end
  end
end

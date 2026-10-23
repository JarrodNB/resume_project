# Preserves object deletion receipts before a session's dependent records disappear.
# No storage request runs in the destroy transaction; cleanup retries and late-write
# reaping continue after the interview or its owner has gone away.
module Interviews
  class DetachMediaService < ApplicationService
    def initialize(interview:)
      @interview = interview
    end

    def call
      @interview.user.with_lock do
        @interview.lock!
        InterviewSessionMedia.where(interview_session_id: @interview.id).update_all(
          interview_session_id: nil, question_id: nil, operation_id: nil, message_id: nil,
          attempt_id: nil, claim_generation: nil, metadata: {}, checksum: nil, byte_size: nil,
          status: "delete_pending", expires_at: Time.current, next_delete_at: nil,
          content_type: "application/octet-stream", updated_at: Time.current)
      end
      success(nil)
    end
  end
end

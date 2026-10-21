# Issues brief playback for an already owner-scoped interview. The persisted message
# selects its accepted speech artifact; callers cannot supply storage keys or URLs.
module Interviews
  class ReadMediaService < ApplicationService
    include MediaPolicy

    def initialize(interview:, message_id:, storage: MediaStorage.new(browser: true))
      @interview, @message_id, @storage = interview, message_id, storage
    end

    def call
      operation = @interview.operations.speech.find_by(message_id: @message_id, status: "accepted")
      media = InterviewSessionMedia.find_by(id: operation&.accepted_result&.fetch("media_id", nil),
        interview_session: @interview, message_id: @message_id, kind: "speech", status: "ready")
      return failure("Audio unavailable or expired") unless media && media_live?(media) && media.operation.accepted? &&
        media.operation.accepted_result["media_id"] == media.id

      seconds = [ GRANT_SECONDS, (media_expiry(media) - Time.current).floor ].min
      return failure("Audio expired") unless seconds.positive?
      receipt = { playback_url: @storage.read_url(key: media.sealed_key, expires_in: seconds), expires_in: seconds,
        content_type: media.content_type }
      with_media_lock(media) do
        next failure("Audio unavailable or expired") unless media_live?(media) && media.operation.accepted? &&
          media.operation.accepted_result["media_id"] == media.id
        success(receipt)
      end
    end
  end
end

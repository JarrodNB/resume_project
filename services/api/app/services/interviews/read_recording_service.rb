# Gives a current turn claim access only to its owned sealed recording. The executor
# must decode and validate these exact bytes before any transcription/provider call.
module Interviews
  class ReadRecordingService < ApplicationService
    include ExecutionPolicy
    include MediaPolicy

    def initialize(operation:, attempt_id:, claim_generation:, storage: MediaStorage.new)
      @operation, @attempt_id, @generation, @storage = operation, attempt_id, claim_generation, storage
    end

    def call
      result = with_operation_lock do |interview|
        next failure("Claim is stale or expired") unless @operation.turn? && current_claim?
        media = InterviewSessionMedia.lock.find_by(id: @operation.recording_id, interview_session: interview,
          question_id: @operation.question_id, kind: "recording", status: "ready")
        next failure("Recording unavailable or expired") unless media && media_live?(media)
        success(media)
      end
      return result unless result.success?
      media = result.value
      seconds = [ GRANT_SECONDS, (media_expiry(media) - Time.current).floor, (@operation.lease_expires_at - Time.current).floor ].min
      return failure("Claim is stale or expired") unless seconds.positive?
      success({ recording_id: media.id, download_url: @storage.read_url(key: media.sealed_key, expires_in: seconds),
        expires_in: seconds, checksum: media.checksum, byte_size: media.byte_size, content_type: media.content_type })
    end
  end
end

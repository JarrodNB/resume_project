# Verifies staged bytes and seals exactly that bounded snapshot outside DB locks.
# The pre-reserved sealed key remains collectible if this process crashes mid-write.
require "digest"

module Interviews
  class RegisterMediaService < ApplicationService
    include MediaPolicy

    def initialize(media:, attempt_id: nil, claim_generation: nil, checksum: nil, byte_size: nil, storage: MediaStorage.new)
      @media, @attempt_id, @generation = media, attempt_id, claim_generation
      @checksum, @byte_size, @storage = checksum, byte_size, storage
    end

    def call
      prepared = with_media_lock(@media) do
        next failure("Media expired or reservation is stale") unless registration_live?
        next failure("Claim is stale or expired") if @media.speech? && !media_claim?(@media)
        if @media.speech?
          next failure("Invalid audio metadata") unless valid_metadata?(@media.content_type, @byte_size, @checksum)
          next failure("Registration conflicts") if @media.checksum && [ @media.checksum, @media.byte_size ] != [ @checksum, @byte_size ]
          @media.update!(checksum: @checksum, byte_size: @byte_size) unless @media.checksum
        end
        success(@media.ready?)
      end
      return prepared unless prepared.success?
      return success({ media_id: @media.id }) if prepared.value

      object = @storage.read(@media.staging_key)
      return failure("Audio bytes do not match reservation") unless matches?(object)
      # Marcel checks actual magic bytes; duration/full decoding runs in Python before
      # transcription. No filename or arbitrary client URL establishes identity.
      detected = Marcel::MimeType.for(StringIO.new(object.fetch(:bytes)))
      detected = "audio/wav" if detected == "audio/x-wav"
      detected = "audio/webm" if detected == "video/webm"
      detected = "audio/mp4" if detected == "video/mp4"
      detected = "audio/ogg" if detected == "application/ogg"
      return failure("Audio container does not match reservation") unless detected == @media.content_type
      fingerprint = Digest::SHA256.hexdigest(object.fetch(:bytes))
      sealing = with_media_lock(@media) do
        next failure("Media expired or claim is stale") unless registration_live? && (!@media.speech? || media_claim?(@media))
        saved = @media.metadata["sealed_sha256"]
        next failure("Sealed audio conflicts") if saved && saved != fingerprint
        @media.update!(metadata: @media.metadata.merge("sealed_sha256" => fingerprint)) unless saved
        success(@media.ready?)
      end
      return sealing unless sealing.success?
      return success({ media_id: @media.id }) if sealing.value
      @storage.write(key: @media.sealed_key, bytes: object.fetch(:bytes), content_type: @media.content_type, checksum: @media.checksum)
      sealed = @storage.read(@media.sealed_key)
      return failure("Sealed audio verification failed") unless matches?(sealed) && Digest::SHA256.digest(sealed[:bytes]) == Digest::SHA256.digest(object[:bytes])
      with_media_lock(@media) do
        unless registration_live? && (!@media.speech? || media_claim?(@media))
          @media.update!(expires_at: Time.current, next_delete_at: Time.current)
          next failure("Media expired or claim is stale")
        end
        @media.update!(status: "ready")
        success({ media_id: @media.id })
      end
    rescue MediaStorage::InvalidObject, Aws::S3::Errors::ServiceError, IOError
      failure("Audio storage unavailable or invalid")
    end

    private

    def registration_live?
      return false unless media_live?(@media)
      return true if @media.speech?

      interview = @media.interview_session
      interview.active? && interview.revision == @media.metadata["expected_revision"] &&
        @media.question.position == interview.current_question_position
    end

    def matches?(object)
      object[:byte_size] == @media.byte_size && object[:byte_size].between?(1, MediaStorage::MAX_BYTES) &&
        object[:checksum] == @media.checksum && object[:content_type] == @media.content_type
    end
  end
end

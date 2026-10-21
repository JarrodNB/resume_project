# Shared private media limits and owner-first locking. Object I/O belongs outside
# these locks; callers recheck authority before committing a downloaded artifact.
module Interviews
  module MediaPolicy
    TYPES = %w[audio/wav audio/webm audio/ogg audio/mp4 audio/mpeg].freeze
    GRANT_SECONDS = 60

    private

    def valid_metadata?(content_type, byte_size, checksum)
      TYPES.include?(content_type) && byte_size.is_a?(Integer) && byte_size.between?(1, MediaStorage::MAX_BYTES) &&
        checksum.is_a?(String) && checksum.match?(/\A[A-Za-z0-9+\/]{22}==\z/)
    end

    def media_expiry(media)
      interview = media.interview_session
      [ media.expires_at, interview.expires_at,
        (interview.completed_at + 1.hour if media.speech? && interview.completed_at) ].compact.min
    end

    def with_media_lock(media)
      interview = media.interview_session
      interview.user.with_lock(requires_new: true) do
        interview.lock!
        interview.questions.order(:position).lock.load
        media.operation&.lock!
        media.operation&.ai_task&.lock!
        media.lock!
        yield interview
      end
    end

    def media_live?(media)
      %w[reserved ready].include?(media.status) && media_expiry(media) > Time.current &&
        !media.interview_session.expired? && !media.interview_session.abandoned?
    end

    def media_claim?(media)
      operation = media.operation
      !media.interview_session.abandoned? && operation&.running? && operation.attempt_id == @attempt_id && operation.claim_generation == @generation &&
        media.attempt_id == @attempt_id && media.claim_generation == @generation &&
        operation.lease_expires_at > Time.current && operation.execution_deadline > Time.current
    end

    def upload_receipt(media, storage)
      seconds = [ GRANT_SECONDS, (media_expiry(media) - Time.current).floor ].min
      return nil unless seconds.positive?
      receipt = { media_id: media.id, upload_url: storage.upload_url(key: media.staging_key, content_type: media.content_type,
        expires_in: seconds, checksum: media.checksum, byte_size: media.byte_size),
        headers: { "Content-Type" => media.content_type }.tap { |headers|
          headers["Content-MD5"] = media.checksum if media.checksum
        }, expires_in: seconds }
      # Signing happens outside locks. Recheck after it so a concurrent abandonment
      # cannot return a fresh grant from an already invalidated reservation.
      with_media_lock(media) do |interview|
        next nil unless media_live?(media)
        if media.speech?
          next nil unless media_claim?(media)
        else
          next nil unless interview.active? && interview.revision == media.metadata["expected_revision"] &&
            interview.current_question_position == media.question.position
        end
        receipt
      end
    end
  end
end

# Removes expired interview content and private audio in bounded batches. Failed object
# deletion stays durable for retry; billing identities survive after dialogue is scrubbed.
module Interviews
  class CleanupService < ApplicationService
    def initialize(limit: 10, storage: MediaStorage.new)
      @limit = Integer(limit).clamp(1, 100)
      @storage = storage
    end

    # @return [ServiceResult<Hash>] counts of scrubbed sessions and deleted media
    def call
      sessions = InterviewSession.where(content_purged_at: nil).where("expires_at <= ?", Time.current).order(:expires_at, :id).limit(@limit)
      purged = sessions.count { |interview| purge_content(interview) }
      media = InterviewSessionMedia.left_joins(:interview_session).where.not(status: "deleted")
        .where("interview_session_media.interview_session_id IS NULL OR interview_session_media.expires_at <= :now OR interview_sessions.expires_at <= :now OR (interview_session_media.kind = 'speech' AND interview_sessions.completed_at <= :cutoff)", now: Time.current, cutoff: 1.hour.ago)
        .where("next_delete_at IS NULL OR next_delete_at <= ?", Time.current).order(:expires_at, :id).limit(@limit)
      deleted = media.count { |record| delete_media(record) }
      # Separate budgets keep old tombstones from starving freshly expired objects.
      tombstones = InterviewSessionMedia.where(status: "deleted").where("next_delete_at <= ?", Time.current)
        .order(:next_delete_at, :id).limit(@limit)
      reaped = tombstones.count { |record| delete_media(record, reaping: true) }
      success({ purged_sessions: purged, deleted_media: deleted, reaped_media: reaped })
    end

    private

    def purge_content(interview)
      interview.user.with_lock do
        interview.lock!
        return false if interview.content_purged_at || interview.expires_at > Time.current

        interview.questions.order(:position).lock.load
        interview.operations.order(:id).lock.each do |operation|
          operation.ai_task&.with_lock do
            attributes = { input: {}, result: {} }
            if operation.pending? || operation.running?
              attributes.merge!(status: "failed", error_message: "interview_expired", completed_at: Time.current)
            end
            operation.ai_task.update!(attributes)
          end
          state = operation.pending? || operation.running? ? "expired" : operation.status
          operation.update!(status: state, accepted_result: {}, retry_at: nil, checkpoint: nil)
        end
        interview.questions.update_all(content: "[expired]", model_history: [])
        interview.messages.update_all(content: "[expired]")
        interview.update!(status: interview.abandoned? ? "abandoned" : "expired", fixture_context: {}, frozen_context: {}, prepared_role: {}, content_purged_at: Time.current)
      end
      true
    end

    def delete_media(record, reaping: false)
      keys = record.with_lock do
        next if (record.deleted? && !reaping) || (record.next_delete_at && record.next_delete_at > Time.current)

        record.update!(status: reaping ? "deleted" : "delete_pending", deletion_attempts: record.deletion_attempts + 1,
          next_delete_at: 5.minutes.from_now)
        [ record.staging_key, record.sealed_key ].compact.uniq
      end
      return false unless keys

      keys.each { |key| @storage.delete(key) }
      record.with_lock do
        # Keep only random keys as durable tombstones. A paused/crashed registration
        # may finish its write after deletion; periodic reaping removes that late object.
        record.update!(status: "deleted", metadata: {}, checksum: nil, byte_size: nil,
          deleted_at: record.deleted_at || Time.current, next_delete_at: 1.hour.from_now, last_delete_error: nil)
      end
      true
    rescue StandardError
      # Storage errors can include signed URLs or object keys. Persist only a safe code.
      record.with_lock { record.update!(last_delete_error: "storage_delete_failed", next_delete_at: 5.minutes.from_now) }
      false
    end
  end
end

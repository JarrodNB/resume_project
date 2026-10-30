# Removes expired interview content and private audio in bounded batches. Failed object
# deletion stays durable for retry; billing identities survive after dialogue is scrubbed.
# Terminal task changes record owner-visible outcomes in the same transaction.
module Interviews
  class CleanupService < ApplicationService
    def initialize(limit: 10, storage: MediaStorage.new)
      @limit = Integer(limit).clamp(1, 100)
      @storage = storage
    end

    # @return [ServiceResult<Hash>] counts of scrubbed sessions and deleted media
    def call
      expire_operations
      InterviewSessionOperation.transcription.where.not(accepted_result: {})
        .joins("LEFT JOIN interview_session_media review_audio ON review_audio.id = interview_session_operations.recording_id")
        .where("review_audio.id IS NULL OR review_audio.expires_at <= ?", Time.current)
        .order(:id).limit(@limit).each do |operation|
        media = InterviewSessionMedia.find_by(id: operation.recording_id)
        CancelRecordedTranscriptionService.call(operation: operation) if !media || media.expires_at <= Time.current
      end
      cleanup_captures
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

    # Expiry used to be a side effect of work discovery. Maintenance now retires
    # only expired/stale operations; it never searches for runnable work.
    def expire_operations
      now = Time.current
      recording_join = "LEFT JOIN interview_session_media recording ON recording.id = interview_session_operations.recording_id"
      expired = InterviewSessionOperation.joins(:interview_session).joins(recording_join)
        .where(status: %w[pending running failed])
        .where("(interview_session_operations.kind = 'transcription' AND (interview_sessions.status <> 'active' OR expected_revision <> interview_sessions.revision)) OR interview_sessions.expires_at <= :now OR retry_expires_at <= :now OR (interview_session_operations.kind IN ('turn', 'transcription') AND ((recording.id IS NULL AND interview_session_operations.transcription_mode <> 'typed') OR recording.expires_at <= :now OR interview_session_operations.created_at <= :cutoff)) OR (interview_session_operations.kind = 'speech' AND interview_sessions.completed_at <= :cutoff)", now: now, cutoff: now - 1.hour)
      expired.order(:created_at, :id).limit(@limit).each do |operation|
        OperationStatusService.call(operation: operation)
      end
    end

    def cleanup_captures
      candidates = InterviewTranscriptionCapture.joins(:interview_session)
        .where("(interview_transcription_captures.status IN ('authorized', 'streaming') AND (interview_transcription_captures.expires_at <= :now OR interview_sessions.expires_at <= :now OR interview_sessions.status = 'abandoned')) OR (interview_transcription_captures.transcript IS NOT NULL AND (interview_sessions.expires_at <= :now OR interview_sessions.status = 'abandoned'))", now: Time.current)
        .order(:id).limit(@limit)
      candidates.each do |capture|
        interview = capture.interview_session
        interview.user.with_lock do
          interview.lock!
          capture.lock!
          capture.ai_task&.lock!
          expired = capture.expires_at <= Time.current || interview.expires_at <= Time.current || interview.abandoned?
          next unless expired
          if %w[authorized streaming].include?(capture.status)
            capture.update!(status: "failed", transcript: nil)
            AiTasks::UpdateTaskService.call(task: capture.ai_task, attributes: { status: "failed", completed_at: Time.current, error_message: "capture_expired" }) if capture.ai_task
          elsif interview.expires_at <= Time.current || interview.abandoned?
            capture.update!(transcript: nil)
          end
        end
      end
    end

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
            AiTasks::UpdateTaskService.call(task: operation.ai_task, attributes: attributes)
          end
          state = operation.pending? || operation.running? ? "expired" : operation.status
          operation.update!(status: state, candidate_transcript: nil, accepted_result: {}, retry_at: nil, checkpoint: nil)
        end
        interview.career_references.update_all(references: [])
        interview.clarifications.update_all(explanation: nil)
        SessionFeedback.new.purge(interview: interview)
        interview.user.ai_tasks.where(subject: interview, task_type: %w[interview_clarification interview_references]).find_each do |task|
          task.with_lock do
            AiTasks::UpdateTaskService.call(task: task, attributes: { input: {}, result: nil, status: task.finished? ? task.status : "failed",
              error_message: "interview_expired", completed_at: task.completed_at || Time.current })
          end
        end
        interview.questions.update_all(content: "[expired]", model_history: [])
        interview.messages.update_all(content: "[expired]", acknowledgement: nil)
        interview.update!(status: interview.abandoned? ? "abandoned" : "expired", fixture_context: {}, career_focus: "", prepared_role: {}, content_purged_at: Time.current)
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

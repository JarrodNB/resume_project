# Finds a small batch of eligible persisted work. Discovery grants no lease; replicas
# must still claim each ID. Excluding expired/ineligible work keeps batches useful.
module Interviews
  class DiscoverOperationsService < ApplicationService
    def initialize(execution_mode: "fake")
      @execution_mode = execution_mode
    end

    def call
      return failure("Interview execution mode unavailable") unless ExecutionConfiguration::PRESETS.key?(@execution_mode)
      now = Time.current
      recording_join = "LEFT JOIN interview_session_media recording ON recording.id = interview_session_operations.recording_id"
      expired = InterviewSessionOperation.joins(:interview_session).joins(recording_join).where(interview_sessions: { execution_mode: @execution_mode }).where(status: %w[pending running failed])
        .where("interview_sessions.expires_at <= :now OR retry_expires_at <= :now OR (interview_session_operations.kind = 'turn' AND (recording.id IS NULL OR recording.expires_at <= :now)) OR (interview_session_operations.kind = 'speech' AND interview_sessions.completed_at <= :cutoff)", now: now, cutoff: now - 1.hour)
      expired.order(:created_at, :id).limit(10).each do |operation|
        OperationStatusService.call(operation: operation)
      end
      candidates = InterviewSessionOperation.joins(:interview_session).left_joins(:question)
        .joins(recording_join)
        .where(interview_sessions: { execution_mode: @execution_mode, expires_at: now.. }).where.not(interview_sessions: { status: "expired" })
        .where("retry_expires_at IS NULL OR retry_expires_at > ?", now)
        .where("(interview_session_operations.kind = 'preparation' AND interview_sessions.status = 'preparing') OR (interview_session_operations.kind = 'turn' AND recording.status = 'ready' AND recording.expires_at > :now AND interview_sessions.status = 'active' AND expected_revision = interview_sessions.revision AND interview_session_questions.position = interview_sessions.current_question_position) OR (interview_session_operations.kind = 'speech' AND (interview_sessions.completed_at IS NULL OR interview_sessions.completed_at > :speech_cutoff))", now: now, speech_cutoff: now - 1.hour)
        .where("(interview_session_operations.status = 'pending' AND execution_count < 6 AND cycle_execution_count < 3 AND (retry_at IS NULL OR retry_at <= :now)) OR (interview_session_operations.status = 'running' AND (lease_expires_at <= :now OR execution_deadline <= :now))", now: now)
      success(candidates.order(:created_at, :id).limit(10).pluck(:id))
    end
  end
end

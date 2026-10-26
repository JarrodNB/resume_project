# Saves an exact transcription once for private review; it creates no dialogue or progress.
# Terminal task changes record owner-visible outcomes in the same transaction.
require "digest"

module Interviews
  class AcceptTranscriptionService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:, attempt_id:, claim_generation:, transcript:)
      @operation, @attempt_id, @generation, @transcript = operation, attempt_id, claim_generation, transcript
    end

    def call
      return failure("Invalid transcript") unless @transcript.is_a?(String) && @transcript.strip.present? && @transcript.length <= 4000
      with_operation_lock do |interview|
        next failure("Not transcription work") unless @operation.transcription?
        next failure("Interview revision is stale") unless interview.active? && interview.expires_at > Time.current &&
          interview.revision == @operation.expected_revision && interview.current_question_position == @operation.question.position
        next failure("An answer is already processing") if interview.operations.turn.where(status: %w[pending running]).exists?
        media = InterviewSessionMedia.lock.find_by(id: @operation.recording_id, interview_session: interview, kind: "recording", status: "ready")
        next failure("Recording expired") unless media && media.expires_at > Time.current
        fingerprint = Digest::SHA256.hexdigest(@transcript)
        if @operation.accepted?
          next @operation.result_fingerprint == fingerprint ? success({ operation_id: @operation.id }) : failure("Transcript conflicts")
        end
        next failure("Claim is stale or expired") unless current_claim?
        @operation.update!(status: "accepted", accepted_at: Time.current, result_fingerprint: fingerprint,
          accepted_result: { transcript: @transcript })
        AiTasks::UpdateTaskService.call(task: @operation.ai_task, attributes: { status: "completed", completed_at: Time.current }) if @operation.ai_task
        success({ operation_id: @operation.id })
      end
    end
  end
end

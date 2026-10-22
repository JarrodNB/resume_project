# Reserves a durable answer slot before execution. Repeated browser requests resolve by
# their original inputs even after the interview advances; no media authority is issued.
require "digest"

module Interviews
  class SubmitTurnService < ApplicationService
    MAX_PREPARED_SUBMISSIONS_PER_QUESTION = 6
    def initialize(interview:, question_id:, expected_revision:, recording_id: nil, submission_key:, candidate_transcript: nil, transcription_mode: "recorded", transcript_digest: nil)
      @interview = interview
      @question_id, @recording_id = question_id, recording_id
      @expected_revision, @submission_key = expected_revision, submission_key
      @candidate_transcript, @transcription_mode, @transcript_digest = candidate_transcript, transcription_mode, transcript_digest
    end

    # The caller supplies an authorized interview; any attached recording ownership/readiness
    # are checked here under the same lock as the processing-slot reservation.
    # @return [ServiceResult<InterviewSessionOperation>] original or newly reserved turn
    def call
      return failure("Invalid submission") unless valid_input?

      @interview.user.with_lock do
        @interview.lock!
        identity = [ @question_id, @recording_id, @expected_revision ]
        digest = @candidate_transcript ? Digest::SHA256.hexdigest(@candidate_transcript) : @transcript_digest
        identity += [ @transcription_mode, digest ] unless @transcription_mode == "recorded" && digest.nil?
        fingerprint = Digest::SHA256.hexdigest(JSON.generate(identity))
        existing = @interview.operations.turn.find_by(submission_key: @submission_key)
        if existing
          next existing.request_fingerprint == fingerprint ? success(existing) : failure("Submission key conflicts with its original inputs")
        end
        next failure("Final transcript is unavailable. Check saved status before submitting the recording as fallback.") if @transcript_digest && !@candidate_transcript
        next failure("Interview is not active") unless @interview.active? && @interview.expires_at > Time.current
        next failure("Interview revision is stale") unless @expected_revision == @interview.revision

        question = @interview.questions.lock.find_by(id: @question_id, position: @interview.current_question_position)
        next failure("Question is not current") unless question
        if @recording_id
          recording = InterviewSessionMedia.lock.find_by(id: @recording_id, interview_session: @interview,
            question: question, kind: "recording", status: "ready")
          next failure("Recording is not available") unless recording && recording.expires_at > Time.current
          next failure("Recording has already been submitted") if @interview.operations.turn.where(recording_id: @recording_id).exists?
        end
        next failure("An answer is already processing") if @interview.operations.turn.where(status: %w[pending running]).exists?
        if @interview.frozen_context.present? && @interview.operations.turn.where(question: question).count >= MAX_PREPARED_SUBMISSIONS_PER_QUESTION
          next failure("This question reached its answer submission limit. Abandon this interview and prepare another to continue.")
        end

        success(@interview.operations.create!(kind: "turn", question: question, recording_id: @recording_id,
          expected_revision: @expected_revision, submission_key: @submission_key, request_fingerprint: fingerprint,
          candidate_transcript: @candidate_transcript, transcription_mode: @transcription_mode))
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    def valid_input?
      uuid = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/
      return false unless %w[recorded browser streaming typed].include?(@transcription_mode)
      return false if @candidate_transcript && (!@candidate_transcript.is_a?(String) || @candidate_transcript.blank? || @candidate_transcript.length > 4000 || @transcription_mode == "recorded")
      return false if @transcript_digest && (!@transcript_digest.is_a?(String) || !@transcript_digest.match?(/\A[0-9a-f]{64}\z/) || @transcription_mode == "recorded")
      return false if @candidate_transcript && @transcript_digest && Digest::SHA256.hexdigest(@candidate_transcript) != @transcript_digest

      return false if @transcription_mode == "typed" && !@candidate_transcript && !@transcript_digest
      return false if @recording_id.nil? && @transcription_mode != "typed"

      @question_id.is_a?(String) && @question_id.match?(uuid) &&
        (@recording_id.nil? || (@recording_id.is_a?(String) && @recording_id.match?(uuid))) &&
        @expected_revision.is_a?(Integer) && @expected_revision >= 0 &&
        @submission_key.is_a?(String) && @submission_key.present? && @submission_key.length <= 200
    end
  end
end

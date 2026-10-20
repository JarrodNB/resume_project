# Reserves a durable answer slot before execution. Repeated browser requests resolve by
# their original inputs even after the interview advances; no media authority is issued.
require "digest"

module Interviews
  class SubmitTurnService < ApplicationService
    def initialize(interview:, question_id:, recording_id:, expected_revision:, submission_key:)
      @interview = interview
      @question_id, @recording_id = question_id, recording_id
      @expected_revision, @submission_key = expected_revision, submission_key
    end

    # The caller supplies an already-authorized interview and, once media exists, an
    # already-authorized recording identity. This internal seam has no HTTP entrypoint.
    # @return [ServiceResult<InterviewSessionOperation>] original or newly reserved turn
    def call
      return failure("Invalid submission") unless valid_input?

      @interview.user.with_lock do
        @interview.lock!
        fingerprint = Digest::SHA256.hexdigest(JSON.generate([ @question_id, @recording_id, @expected_revision ]))
        existing = @interview.operations.turn.find_by(submission_key: @submission_key)
        if existing
          next existing.request_fingerprint == fingerprint ? success(existing) : failure("Submission key conflicts with its original inputs")
        end
        next failure("Interview is not active") unless @interview.active? && @interview.expires_at > Time.current
        next failure("Interview revision is stale") unless @expected_revision == @interview.revision

        question = @interview.questions.lock.find_by(id: @question_id, position: @interview.current_question_position)
        next failure("Question is not current") unless question
        next failure("An answer is already processing") if @interview.operations.turn.where(status: %w[pending running]).exists?

        success(@interview.operations.create!(kind: "turn", question: question, recording_id: @recording_id,
          expected_revision: @expected_revision, submission_key: @submission_key, request_fingerprint: fingerprint))
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    def valid_input?
      uuid = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/
      @question_id.is_a?(String) && @question_id.match?(uuid) &&
        @recording_id.is_a?(String) && @recording_id.match?(uuid) &&
        @expected_revision.is_a?(Integer) && @expected_revision >= 0 &&
        @submission_key.is_a?(String) && @submission_key.present? && @submission_key.length <= 200
    end
  end
end

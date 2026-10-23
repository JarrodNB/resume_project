# Reserve a short-lived owned capture, without contacting or charging a provider.
require "digest"

module Interviews
  class AuthorizeTranscriptionService < ApplicationService
    def initialize(interview:, question_id:, expected_revision:)
      @interview, @question_id, @revision = interview, question_id, expected_revision
    end

    # @return [ServiceResult<Hash>] one opaque, single-use streaming capability
    def call
      @interview.user.with_lock do
        @interview.lock!
        next failure("Interview is not active") unless @interview.active? && @interview.expires_at > Time.current && @interview.execution_mode == "real"
        next failure("Interview revision is stale") unless @revision.is_a?(Integer) && @revision == @interview.revision
        question = @interview.questions.find_by(id: @question_id, position: @interview.current_question_position)
        next failure("Question is not current") unless question
        next failure("An answer is already processing") if @interview.operations.turn.where(status: %w[pending running]).exists?
        captures = InterviewTranscriptionCapture.where(interview_session: @interview)
        # A permission request can outlive a cancelled browser attempt. Replacing
        # an unredeemed capability spends nothing and fences its late callback.
        captures.where(status: "authorized").update_all(status: "failed", updated_at: Time.current)
        captures.where(status: %w[authorized streaming]).where("expires_at <= ?", Time.current).find_each do |capture|
          capture.update!(status: "failed", transcript: nil)
          capture.ai_task&.update!(status: "failed", completed_at: Time.current, error_message: "capture_expired")
        end
        next failure("A transcription is already active") if captures.where(status: %w[authorized streaming]).exists?
        active = InterviewTranscriptionCapture.joins(:interview_session)
          .where(interview_sessions: { user_id: @interview.user_id }, status: "streaming")
          .where("interview_transcription_captures.expires_at > ?", Time.current)
        next failure("Another transcription is already active") if active.exists?
        next failure("This question reached its streaming capture limit") if captures.where(question: question).count >= 6
        root = @interview.operations.preparation.first&.ai_task
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @interview.user, existing_task: root, interview: true)
        next allowance unless allowance.success?
        token = SecureRandom.urlsafe_base64(32)
        capture = captures.create!(question: question, expected_revision: @revision,
          token_digest: Digest::SHA256.hexdigest(token), observation_id: SecureRandom.uuid,
          expires_at: [ 150.seconds.from_now, @interview.expires_at ].min)
        success({ capture_id: capture.id, token: token })
      end
    end
  end
end

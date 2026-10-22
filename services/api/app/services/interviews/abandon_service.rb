# Stops an unfinished interview without deleting its accounting evidence. Audio becomes
# unavailable in the transaction; bounded cleanup deletes objects later and reaps late writes.
module Interviews
  class AbandonService < ApplicationService
    def initialize(interview:)
      @interview = interview
    end

    # @return [ServiceResult<InterviewSession>] the same terminal interview on replay
    def call
      @interview.user.with_lock do
        @interview.lock!
        next success(@interview) if @interview.abandoned?
        next failure("Interview cannot be abandoned") unless %w[preparing ready active].include?(@interview.status) && @interview.expires_at > Time.current

        @interview.questions.order(:position).lock.load
        @interview.operations.order(:id).lock.each do |operation|
          operation.ai_task&.lock!
          operation.update!(candidate_transcript: nil) if operation.candidate_transcript
          next if operation.accepted? || operation.expired?

          operation.update!(status: "expired", retry_at: nil, checkpoint: nil,
            claim_generation: operation.claim_generation + 1, failure_code: "interview_abandoned")
          # Do not finalize execution/provider usage markers: an in-flight provider
          # can still report its real charge, and unknown spend must remain unknown.
          operation.ai_task&.update!(status: "failed", error_message: "interview_abandoned", completed_at: Time.current)
        end
        InterviewSessionMedia.where(interview_session: @interview).order(:id).lock.each do |media|
          media.update!(status: media.deleted? ? "deleted" : "delete_pending", expires_at: Time.current,
            next_delete_at: media.deleted? ? Time.current : nil)
        end
        @interview.update!(status: "abandoned", revision: @interview.revision + 1)
        success(@interview)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end

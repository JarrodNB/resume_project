# Ends a live interview's room connection and finishes the interview by one rule: it is
# completed when at least one answer is saved, and abandoned (the same clean-up as the
# Abandon button) when none is. The live agent calls it when it closes or the candidate ends
# the interview; the owner's End interview mutation calls it when the agent is gone. A repeat
# after the interview finished returns the first outcome unchanged.
module Interviews
  class FinishLiveService < ApplicationService
    REASONS = %w[completed ended_by_candidate failed].freeze

    def initialize(connection:, reason:)
      @connection, @reason = connection, reason
    end

    # @return [ServiceResult<Hash>] `{ status:, end_reason:, revision: }`
    def call
      return failure("Unsupported finish reason") unless REASONS.include?(@reason)

      interview = @connection.interview_session
      interview.user.with_lock do
        interview.lock!
        @connection.lock!
        next success(receipt(interview)) if @connection.status == "ended" && (interview.completed? || interview.abandoned?)
        refusal = LiveConnectionAccess.refusal(interview, @connection)
        next failure(refusal) if refusal

        @connection.update!(status: "ended", ended_at: Time.current, end_reason: @reason)
        if interview.messages.answer.exists?
          interview.update!(status: "completed", completed_at: Time.current, revision: interview.revision + 1)
        else
          abandoned = AbandonService.call(interview: interview)
          raise ActiveRecord::Rollback, "abandon failed" unless abandoned.success?
        end
        success(receipt(interview))
      end || failure("Interview could not be finished")
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    def receipt(interview)
      { status: interview.status, end_reason: @connection.end_reason, revision: interview.revision }
    end
  end
end

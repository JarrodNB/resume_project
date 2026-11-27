# Ends a live interview's room connection and finishes the interview by one rule: it is
# completed when at least one answer is saved, and abandoned (the same clean-up as the
# Abandon button) when none is. The live agent calls it when it closes or the candidate ends
# the interview (`idle` when the coaching menu waited three minutes without a choice,
# `time_limit` after 25 counted minutes, `allowance` when the live minutes ran out); the
# owner's End interview mutation calls it when the agent is gone. It also closes the
# connection's provider bill: known only when the agent names its final heartbeat
# (`final_sequence`) and that was the last one applied. A repeat after the interview finished
# returns the first outcome unchanged.
module Interviews
  class FinishLiveService < ApplicationService
    REASONS = %w[completed ended_by_candidate idle time_limit allowance failed].freeze

    def initialize(connection:, reason:, final_sequence: nil)
      @connection, @reason, @final_sequence = connection, reason, final_sequence
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
        LiveConversationBill.close(@connection, known: @final_sequence.is_a?(Integer) && @final_sequence == @connection.heartbeat_sequence)
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

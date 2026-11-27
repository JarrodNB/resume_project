# Ends a live interview's room connection and finishes the interview by one rule: it is
# completed when at least one answer is saved, and abandoned (the same clean-up as the
# Abandon button) when none is. The live agent calls it when it closes or the candidate ends
# the interview (`idle` when the coaching menu waited three minutes without a choice,
# `time_limit` after 25 counted minutes, `allowance` when the live minutes ran out,
# `disconnected` when the candidate stayed away 2 minutes); the owner's End interview mutation
# calls it when the agent is gone (through `for_owner`), and Interviews::RecoverLiveConnectionsService when the agent's
# heartbeat stopped (`disconnected`) or a joined room was never claimed (`failed`). It also closes the
# connection's provider bill: known only when the agent names its final heartbeat
# (`final_sequence`) and that was the last one applied. A repeat after the interview finished
# returns the first outcome unchanged.
#
# Recovery passes `stale_before`: the finish then goes ahead only while the connection's last
# sign of life (heartbeat, claim or join) is still that old, so a late heartbeat wins the race.
# For recovery only, a quiet connection whose interview already finished or expired is just
# closed (bill unknown), leaving the interview as it is. Otherwise an ended connection or a session
# that is no longer live and active is refused with the shared `connection_ended` code
# (Interviews::LiveConnectionAccess), like every other agent callback. `close_open` closes the same way the
# open connection of an interview that ends another way (abandoned or expired).
module Interviews
  class FinishLiveService < ApplicationService
    REASONS = %w[completed ended_by_candidate idle time_limit allowance disconnected failed].freeze

    # The owner ending the interview from the room: finishes its open connection (or, on a repeat,
    # the latest one) as `ended_by_candidate`, or as `failed` when the live room was unavailable
    # and the candidate is switching to a turn-based interview with the same setup.
    #
    # The agent's refusal codes (`connection_ended`, `invalid_request`) are for the agent, so the
    # owner's failure carries only the message.
    #
    # @return [ServiceResult<Hash>] as `call`, or a failure when the interview never opened a room
    def self.for_owner(interview:, live_unavailable: false)
      connection = interview.live_connections.open.first || interview.live_connections.order(:created_at).last
      return ServiceResult.new(success: false, value: nil, errors: [ "This interview has no live room" ]) unless connection

      result = call(connection: connection, reason: live_unavailable ? "failed" : "ended_by_candidate")
      result.success? ? result : result.with(code: nil)
    end

    # Closes the interview's open live connection, if any, with the bill unknown (no final heartbeat
    # was named), so the agent's next call is refused as `connection_ended` and it leaves. Callers
    # hold the user and interview locks; the connection is locked next, as the live lock order says.
    def self.close_open(interview, reason:)
      interview.live_connections.open.order(:id).lock.each { |connection| close_only(connection, reason) }
    end

    # Ends one locked connection and closes its bill as unknown, leaving the interview as it is.
    def self.close_only(connection, reason)
      connection.update!(status: "ended", ended_at: Time.current, end_reason: reason)
      LiveConversationBill.close(connection, known: false)
    end

    def initialize(connection:, reason:, final_sequence: nil, stale_before: nil)
      @connection, @reason, @final_sequence, @stale_before = connection, reason, final_sequence, stale_before
    end

    # @return [ServiceResult<Hash>] `{ status:, end_reason:, revision: }`
    def call
      return LiveConnectionAccess.invalid_request("Unsupported finish reason") unless REASONS.include?(@reason)
      return LiveConnectionAccess.invalid_request("Invalid final heartbeat") unless @final_sequence.nil? || @final_sequence.is_a?(Integer)

      interview = @connection.interview_session
      interview.user.with_lock do
        interview.lock!
        @connection.lock!
        next success(receipt(interview)) if @connection.status == "ended" && (interview.completed? || interview.abandoned?)
        next failure("Live connection is not quiet") if @stale_before && !quiet?
        refusal = LiveConnectionAccess.refusal(interview, @connection)
        next close_only if refusal && @stale_before && @connection.status != "ended"
        next LiveConnectionAccess.ended(refusal) if refusal # the agent leaves, as for every live callback

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

    def quiet?
      @connection.status != "ended" &&
        (@connection.last_heartbeat_at || @connection.connected_at || @connection.created_at) <= @stale_before
    end

    def close_only
      self.class.close_only(@connection, @reason)
      success(receipt(@connection.interview_session))
    end

    def receipt(interview)
      { status: interview.status, end_reason: @connection.end_reason, revision: interview.revision }
    end
  end
end

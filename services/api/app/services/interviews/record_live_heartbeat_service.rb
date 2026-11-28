# The live agent's heartbeat, about every 30 seconds: counted seconds since the last heartbeat
# (coaching menu waits excluded) and provider usage deltas. Each sequence number is applied once;
# repeating the latest one replays its answer without changes and an older one is refused.
# The answer tells the agent to carry on, or to wrap up now: with `allowance` because the user's
# hidden live budget is spent (LiveAllowance; this heartbeat's own cost already counts), or with
# `time_limit` because the session's 25 counted minutes are used or the connection reached its
# 45-minute wall-clock cap (LiveAllowance::CONNECTION_WALL_CLOCK; menu waits are free, so counted
# time alone has no end). Nothing warns about the budget first, and no amount is sent. Usage for a model the
# live bill does not know is refused with the code `unknown_usage_model` (and logged), because
# it means the agent and Rails disagree on the live models.
module Interviews
  class RecordLiveHeartbeatService < ApplicationService
    def initialize(connection:, sequence:, billed_seconds_delta:, usage:)
      @connection, @sequence, @billed_seconds_delta = connection, sequence, billed_seconds_delta
      @usage = usage.nil? ? [] : usage
    end

    # @return [ServiceResult<Hash>] `{ action: "continue" | "wrap_up", session_seconds_left:,
    #   reason: "allowance" | "time_limit" (wrap_up only) }`
    def call
      @usage = @usage.map { |entry| entry.respond_to?(:to_h) ? entry.to_h.stringify_keys : entry } if @usage.is_a?(Array)
      if LiveConversationBill.unknown_model?(@usage)
        Rails.logger.error("Live heartbeat refused: unknown_usage_model (live connection #{@connection.id})")
        return failure("Heartbeat usage names a model that live interviews do not bill", code: :unknown_usage_model)
      end
      return LiveConnectionAccess.invalid_request("Invalid heartbeat") unless valid?

      LiveConnectionAccess.with_locked(@connection, claimed: true) do |interview|
        next failure("Heartbeat sequence is stale") if @sequence < @connection.heartbeat_sequence
        if @sequence > @connection.heartbeat_sequence
          @connection.update!(heartbeat_sequence: @sequence, last_heartbeat_at: Time.current,
            billed_seconds: @connection.billed_seconds + @billed_seconds_delta)
          LiveConversationBill.add(@connection, @usage)
        end
        success(answer(interview))
      end
    end

    private

    def valid?
      @sequence.is_a?(Integer) && @sequence.between?(1, 1_000_000) && @billed_seconds_delta.is_a?(Integer) &&
        @billed_seconds_delta.between?(0, LiveAllowance::SESSION_SECONDS) && LiveConversationBill.valid_usage?(@usage)
    end

    def answer(interview)
      session = LiveAllowance.session_seconds_left(interview)
      return { action: "wrap_up", reason: "allowance", session_seconds_left: session } if LiveAllowance.remaining_microdollars(interview.user) <= 0
      return { action: "wrap_up", reason: "time_limit", session_seconds_left: session } if session <= 0 || LiveAllowance.wall_clock_passed?(@connection)

      { action: "continue", session_seconds_left: session }
    end
  end
end

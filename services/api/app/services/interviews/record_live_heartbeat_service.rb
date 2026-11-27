# The live agent's heartbeat, about every 30 seconds: counted seconds since the last heartbeat
# (coaching menu waits excluded) and provider usage deltas. Each sequence number is applied once;
# repeating the latest one replays its answer without changes and an older one is refused.
# The answer tells the agent to carry on, to warn the candidate (2 minutes of live allowance
# left) or to wrap up now because the allowance ran out or the session's 25 counted minutes are
# used. The allowance counts this connection's own billed seconds too.
module Interviews
  class RecordLiveHeartbeatService < ApplicationService
    def initialize(connection:, sequence:, billed_seconds_delta:, usage:)
      @connection, @sequence, @billed_seconds_delta = connection, sequence, billed_seconds_delta
      @usage = usage.nil? ? [] : usage
    end

    # @return [ServiceResult<Hash>] `{ action: "continue" | "warn" | "wrap_up", allowance_seconds_left:,
    #   session_seconds_left:, reason: "allowance" | "time_limit" (wrap_up only) }`
    def call
      @usage = @usage.map { |entry| entry.respond_to?(:to_h) ? entry.to_h.stringify_keys : entry } if @usage.is_a?(Array)
      return failure("Invalid heartbeat") unless valid?

      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("Live connection has not been claimed") unless @connection.status == "connected" && @connection.ai_task
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
      allowance = LiveAllowance.remaining_seconds(interview.user)
      session = LiveAllowance.session_seconds_left(interview)
      seconds = { allowance_seconds_left: allowance, session_seconds_left: session }
      return { action: "wrap_up", reason: "allowance", **seconds } if allowance <= 0
      return { action: "wrap_up", reason: "time_limit", **seconds } if session <= 0
      return { action: "warn", **seconds } if allowance <= LiveAllowance::WARNING_SECONDS

      { action: "continue", **seconds }
    end
  end
end

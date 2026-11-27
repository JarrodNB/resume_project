# The shared check every live agent callback makes before it changes anything: the connection
# must still be open and its interview must be a live, active, unexpired session. Callers hold
# the user, interview and connection locks (in that order) while they check and write.
# Every refusal here means the agent's work is over (recovery or the owner ended the connection, or
# the session finished, expired or left live mode), so it carries the `connection_ended` code: the
# agent then leaves the room instead of talking on until its own time limit. A malformed request
# (wrong parameter types or unknown values) is refused up front with `invalid_request` instead,
# which the controller answers with 422 so the agent logs it as a bug rather than a stale report.
module Interviews
  module LiveConnectionAccess
    ENDED_CODE = :connection_ended
    INVALID_CODE = :invalid_request

    # @return [ServiceResult] a failure for a malformed agent request
    def self.invalid_request(message)
      ServiceResult.new(success: false, value: nil, errors: [ message ], code: INVALID_CODE)
    end

    # True for a question position or count sent as a JSON integer (never a string or float).
    def self.count?(value)
      value.is_a?(Integer) && value >= 0
    end

    # @return [String, nil] why the agent may not act for this connection, or nil when it may
    def self.refusal(interview, connection)
      return "Live connection has ended" if connection.status == "ended"
      return "This interview is not a live interview" unless interview.conversation_live?
      return "Interview expired" if interview.expired? || interview.expires_at <= Time.current
      return "Interview is not active" unless interview.active?
      nil
    end

    # Runs the block under the user, interview and connection locks with the access check done.
    # With `claimed: true` the agent must also have claimed the connection (connected, with its
    # bill open); every callback after the claim needs that.
    # @yieldparam interview [InterviewSession]
    # @return [ServiceResult] the block's result, a `connection_ended` failure naming the refusal,
    #   or a plain failure for an unclaimed connection
    def self.with_locked(connection, claimed: false)
      interview = connection.interview_session
      interview.user.with_lock do
        interview.lock!
        connection.lock!
        reason = refusal(interview, connection)
        next ServiceResult.new(success: false, value: nil, errors: [ reason ], code: ENDED_CODE) if reason
        if claimed && !(connection.status == "connected" && connection.ai_task_id)
          next ServiceResult.new(success: false, value: nil, errors: [ "The live agent has not claimed this connection" ])
        end
        yield interview
      end
    end
  end
end

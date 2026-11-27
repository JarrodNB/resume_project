# The shared check every live agent callback makes before it changes anything: the connection
# must still be open and its interview must be a live, active, unexpired session. Callers hold
# the user, interview and connection locks (in that order) while they check and write.
module Interviews
  module LiveConnectionAccess
    # @return [String, nil] why the agent may not act for this connection, or nil when it may
    def self.refusal(interview, connection)
      return "Live connection has ended" if connection.status == "ended"
      return "This interview is not a live interview" unless interview.conversation_live?
      return "Interview expired" if interview.expired? || interview.expires_at <= Time.current
      return "Interview is not active" unless interview.active?
      nil
    end

    # Runs the block under the user, interview and connection locks with the access check done.
    # @yieldparam interview [InterviewSession]
    # @return [ServiceResult] the block's result, or a failure naming the refusal
    def self.with_locked(connection)
      interview = connection.interview_session
      interview.user.with_lock do
        interview.lock!
        connection.lock!
        reason = refusal(interview, connection)
        next ServiceResult.new(success: false, value: nil, errors: [ reason ]) if reason
        yield interview
      end
    end
  end
end

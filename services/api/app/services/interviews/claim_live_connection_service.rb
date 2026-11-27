# The live agent's first call after LiveKit dispatches it: it proves the dispatch still matches
# an open connection (same room) of a live, active interview, and Rails marks that connection
# connected. The first claim also opens the connection's provider bill (LiveConversationBill).
# Safe to repeat: the first connected time and bill are kept and only the heartbeat moves.
module Interviews
  class ClaimLiveConnectionService < ApplicationService
    def initialize(connection:, room_name:)
      @connection, @room_name = connection, room_name
    end

    # @return [ServiceResult<Hash>] `{ interview_session_id:, live_connection_id:, user_id:,
    #   question_total:, current_question_position:, answer_cap:, current_question_retry_count:,
    #   session_seconds_left:, allowance_seconds_left: }`; only identities and limits, never text
    def call
      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("Live connection does not match this room") unless @room_name.is_a?(String) &&
          ActiveSupport::SecurityUtils.secure_compare(@room_name, @connection.room_name)
        now = Time.current
        @connection.update!(status: "connected", connected_at: @connection.connected_at || now, last_heartbeat_at: now)
        raise ActiveRecord::Rollback unless LiveConversationBill.open(@connection, interview)
        success({ interview_session_id: interview.id, live_connection_id: @connection.id, user_id: interview.user_id,
          question_total: interview.questions.count, current_question_position: interview.current_question_position,
          answer_cap: interview.answer_cap,
          current_question_retry_count: interview.questions.find_by(position: interview.current_question_position)&.live_retry_count || 0,
          session_seconds_left: LiveAllowance.session_seconds_left(interview), allowance_seconds_left: LiveAllowance.remaining_seconds(interview.user) })
      end || failure("Live pricing unavailable")
    end
  end
end

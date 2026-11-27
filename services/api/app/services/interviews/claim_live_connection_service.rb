# The live agent's first call after LiveKit dispatches it: it proves the dispatch still matches
# an open connection (same room) of a live, active interview, and Rails marks that connection
# connected. Safe to repeat: the first connected time is kept and only the heartbeat moves.
module Interviews
  class ClaimLiveConnectionService < ApplicationService
    def initialize(connection:, room_name:)
      @connection, @room_name = connection, room_name
    end

    # @return [ServiceResult<Hash>] `{ interview_session_id:, live_connection_id:, user_id:,
    #   question_total:, current_question_position:, answer_cap:, current_question_retry_count: }`;
    #   only identities and limits, never text
    def call
      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("Live connection does not match this room") unless @room_name.is_a?(String) &&
          ActiveSupport::SecurityUtils.secure_compare(@room_name, @connection.room_name)
        now = Time.current
        @connection.update!(status: "connected", connected_at: @connection.connected_at || now, last_heartbeat_at: now)
        success({ interview_session_id: interview.id, live_connection_id: @connection.id, user_id: interview.user_id,
          question_total: interview.questions.count, current_question_position: interview.current_question_position,
          answer_cap: interview.answer_cap,
          current_question_retry_count: interview.questions.find_by(position: interview.current_question_position)&.live_retry_count || 0 })
      end
    end
  end
end

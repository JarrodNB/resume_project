# The live agent's first call after LiveKit dispatches it: it proves the dispatch still matches
# an open connection (same room) of a live, active interview, and Rails marks that connection
# connected. The first claim also opens the connection's provider bill (LiveConversationBill).
# Safe to repeat: the first connected time and bill are kept and only the heartbeat moves.
# A fresh agent that takes over a running connection (the first agent crashed, or the room was
# re-created after it emptied) claims the same way and learns where the current question stands:
# its latest saved prompt, whether that has an answer, the answers counted and whether feedback
# was given, plus the last heartbeat applied. Only IDs, flags and counts are returned, never text.
module Interviews
  class ClaimLiveConnectionService < ApplicationService
    def initialize(connection:, room_name:)
      @connection, @room_name = connection, room_name
    end

    # @return [ServiceResult<Hash>] `{ interview_session_id:, live_connection_id:, user_id:,
    #   question_total:, current_question_position:, answer_cap:, current_question_retry_count:,
    #   session_seconds_left:, allowance_seconds_left:, heartbeat_sequence:, current_prompt_message_id:,
    #   current_prompt_kind:, current_prompt_answered:, current_question_answer_count:,
    #   current_question_feedback_given: }`; only identities, limits and counts, never text
    def call
      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("Live connection does not match this room") unless @room_name.is_a?(String) &&
          ActiveSupport::SecurityUtils.secure_compare(@room_name, @connection.room_name)
        now = Time.current
        @connection.update!(status: "connected", connected_at: @connection.connected_at || now, last_heartbeat_at: now)
        raise ActiveRecord::Rollback unless LiveConversationBill.open(@connection, interview)
        question = interview.questions.find_by(position: interview.current_question_position)
        success({ interview_session_id: interview.id, live_connection_id: @connection.id, user_id: interview.user_id,
          question_total: interview.questions.count, current_question_position: interview.current_question_position,
          answer_cap: interview.answer_cap, current_question_retry_count: question&.live_retry_count || 0,
          session_seconds_left: LiveAllowance.session_seconds_left(interview), allowance_seconds_left: LiveAllowance.remaining_seconds(interview.user),
          heartbeat_sequence: @connection.heartbeat_sequence, **current_question_state(interview, question) })
      end || failure("Live pricing unavailable")
    end

    private

    def current_question_state(interview, question)
      prompt = question && interview.messages.where(question: question, kind: %w[opening follow_up]).order(:position).last
      { current_prompt_message_id: prompt&.id, current_prompt_kind: prompt&.kind,
        current_prompt_answered: prompt.present? && interview.messages.exists?(semantic_key: "live_answer:#{prompt.id}"),
        current_question_answer_count: question&.accepted_answer_count || 0,
        current_question_feedback_given: question&.live_feedback.present? || false }
    end
  end
end

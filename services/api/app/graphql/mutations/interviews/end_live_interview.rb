# Lets the owner end a live interview from the room when the live agent cannot (it has left or
# did not answer). It runs the same finish as the agent: completed with at least one saved
# answer, abandoned otherwise. When the live room failed and the candidate leaves it for a
# turn-based interview with the same setup (`live_unavailable`), the room ends as `failed`
# by the same rule, so the abandoned live session never stays active.
module Mutations
  module Interviews
    class EndLiveInterview < BaseInterviewMutation
      argument :interview_id, ID, required: true
      argument :live_unavailable, Boolean, required: false, default_value: false,
        description: "True when the live room failed and the candidate is switching to a turn-based interview."
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:, live_unavailable:)
        session = interview(interview_id)
        connection = session.live_connections.open.first || session.live_connections.order(:created_at).last
        return { interview: nil, errors: [ "This interview has no live room" ], error_code: nil } unless connection

        snapshot_result(::Interviews::FinishLiveService.call(connection: connection, reason: live_unavailable ? "failed" : "ended_by_candidate"), session)
      end
    end
  end
end

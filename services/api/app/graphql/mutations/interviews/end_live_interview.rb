# Lets the owner end a live interview from the room when the live agent cannot (it has left or
# did not answer). It runs the same finish as the agent: completed with at least one saved
# answer, abandoned otherwise.
module Mutations
  module Interviews
    class EndLiveInterview < BaseInterviewMutation
      argument :interview_id, ID, required: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:)
        session = interview(interview_id)
        connection = session.live_connections.open.first || session.live_connections.order(:created_at).last
        return { interview: nil, errors: [ "This interview has no live room" ], error_code: nil } unless connection

        snapshot_result(::Interviews::FinishLiveService.call(connection: connection, reason: "ended_by_candidate"), session)
      end
    end
  end
end

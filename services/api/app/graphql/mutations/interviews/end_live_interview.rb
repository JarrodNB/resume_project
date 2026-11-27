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
        snapshot_result(::Interviews::FinishLiveService.for_owner(interview: session, live_unavailable: live_unavailable), session)
      end
    end
  end
end

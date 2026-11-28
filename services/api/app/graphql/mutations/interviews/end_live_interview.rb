# Lets the owner end a live interview from the room when the live agent cannot (it has left or
# did not answer). It runs the same finish as the agent: completed with at least one saved
# answer, abandoned otherwise. A live session whose room was never opened (its first join was
# refused) is abandoned. Leaving an unavailable room for a turn-based interview is not done here:
# starting that interview (`startInterview` with `fromInterviewId`) ends the live room itself.
module Mutations
  module Interviews
    class EndLiveInterview < BaseInterviewMutation
      argument :interview_id, ID, required: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:)
        session = interview(interview_id)
        snapshot_result(::Interviews::FinishLiveService.for_owner(interview: session), session)
      end
    end
  end
end

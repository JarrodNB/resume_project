# Starts the first spoken opening only after the owner reviews the prepared role.
module Mutations
  module Interviews
    class BeginInterview < BaseInterviewMutation
      argument :interview_id, ID, required: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:)
        session = interview(interview_id)
        snapshot_result(::Interviews::BeginService.call(interview: session), session)
      end
    end
  end
end

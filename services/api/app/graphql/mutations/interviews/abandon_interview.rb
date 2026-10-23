# Ends only the current owner's unfinished session; accounting and saved receipts survive.
module Mutations
  module Interviews
    class AbandonInterview < BaseDemoMutation
      argument :interview_id, ID, required: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:)
        session = interview(interview_id)
        snapshot_result(::Interviews::AbandonService.call(interview: session), session)
      end
    end
  end
end

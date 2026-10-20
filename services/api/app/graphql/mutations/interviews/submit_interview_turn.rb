# Exposes one owned demo action through the existing durable interview services.
module Mutations
  module Interviews
    class SubmitInterviewTurn < BaseDemoMutation
      argument :interview_id, ID, required: true
      argument :question_id, ID, required: true
      argument :recording_id, ID, required: true
      argument :expected_revision, Integer, required: true
      argument :submission_key, String, required: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:, **args)
        session = interview(interview_id)
        snapshot_result(::Interviews::SubmitTurnService.call(interview: session, **args), session)
      end
    end
  end
end

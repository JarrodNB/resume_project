# Authorizes a durable skip of the current core-question cycle.
module Mutations
  module Interviews
    class SkipInterviewQuestion < BaseDemoMutation
      argument :interview_id, ID, required: true
      argument :question_id, ID, required: true
      argument :expected_revision, Integer, required: true
      argument :submission_key, String, required: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:, **args)
        session = interview(interview_id)
        snapshot_result(::Interviews::SkipQuestionService.call(interview: session, **args), session)
      end
    end
  end
end

# Exposes one owned interview action through the existing durable interview services.
module Mutations
  module Interviews
    class RetryInterviewOperation < BaseInterviewMutation
      argument :interview_id, ID, required: true
      argument :operation_id, ID, required: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:, **args)
        session = interview(interview_id)
        operation = session.operations.find(args.fetch(:operation_id))
        snapshot_result(::Interviews::RetryOperationService.call(operation: operation), session)
      end
    end
  end
end

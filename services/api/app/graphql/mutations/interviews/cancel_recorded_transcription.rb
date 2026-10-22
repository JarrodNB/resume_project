# Releases only a capture from the authenticated owner's interview.
module Mutations
  module Interviews
    class CancelRecordedTranscription < BaseDemoMutation
      argument :interview_id, ID, required: true
      argument :operation_id, ID, required: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:, operation_id:)
        session = interview(interview_id)
        snapshot_result(::Interviews::CancelRecordedTranscriptionService.call(operation: session.operations.find(operation_id)), session)
      end
    end
  end
end

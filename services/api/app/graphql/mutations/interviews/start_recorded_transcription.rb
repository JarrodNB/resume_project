# Queues owned private audio for transcription without submitting an interview answer.
module Mutations
  module Interviews
    class StartRecordedTranscription < BaseDemoMutation
      argument :interview_id, ID, required: true
      argument :question_id, ID, required: true
      argument :recording_id, ID, required: true
      argument :expected_revision, Integer, required: true
      field :operation_id, ID, null: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:, **args)
        session = interview(interview_id)
        result = ::Interviews::StartRecordedTranscriptionService.call(interview: session, **args)
        snapshot_result(result, session).merge(operation_id: result.success? ? result.value.id : nil)
      end
    end
  end
end

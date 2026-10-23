# Exposes one owned demo action through the existing durable interview services.
module Mutations
  module Interviews
    class AuthorizeInterviewRecording < BaseDemoMutation
      argument :interview_id, ID, required: true
      argument :question_id, ID, required: true
      argument :expected_revision, Integer, required: true
      argument :content_type, String, required: true
      argument :byte_size, Integer, required: true
      argument :checksum, String, required: true
      field :upload, Types::InterviewRecordingUploadType, null: true

      def resolve(interview_id:, **args)
        session = interview(interview_id)
        payload_from(::Interviews::ReserveRecordingService.call(interview: session, **args), :upload)
      end
    end
  end
end

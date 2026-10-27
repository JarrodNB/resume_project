# Exposes one owned interview action through the existing durable interview services.
module Mutations
  module Interviews
    class RegisterInterviewRecording < BaseInterviewMutation
      argument :interview_id, ID, required: true
      argument :media_id, ID, required: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:, **args)
        session = interview(interview_id)
        media = InterviewSessionMedia.where(interview_session: session, kind: "recording").find(args.fetch(:media_id))
        snapshot_result(::Interviews::RegisterMediaService.call(media: media), session)
      end
    end
  end
end

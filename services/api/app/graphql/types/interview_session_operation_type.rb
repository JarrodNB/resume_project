# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewSessionOperationType < Types::BaseObject
    field :can_retry, Boolean, null: false
    field :expected_revision, Integer, null: true
    field :review_transcript, String, null: true
    field :checkpoint, String, null: true
    field :submission_key, String, null: true
    field :id, ID, null: false
    field :question_id, ID, null: true
    field :message_id, ID, null: true
    field :kind, String, null: false
    field :status, String, null: false
    field :failure_code, String, null: true

    def review_transcript
      session = object.interview_session
      return unless object.transcription? && object.accepted? && session.active? && session.expires_at > Time.current &&
        object.expected_revision == session.revision && object.question.position == session.current_question_position &&
        InterviewSessionMedia.where(interview_session: session, id: object.recording_id, kind: "recording").where("expires_at > ?", Time.current).exists?

      object.accepted_result["transcript"]
    end

    def can_retry
      Interviews::RetryEligibilityService.call(operation: object).success?
    end
  end
end

# Publishes only committed changes; rolled-back dialogue is never sent to browsers.
module PublishesInterviewSnapshot
  extend ActiveSupport::Concern

  included do
    after_commit :publish_interview_snapshot, on: [ :create, :update ]
  end

  private

  def publish_interview_snapshot
    if is_a?(InterviewSessionOperation)
      public_changes = %w[id status checkpoint failure_code message_id submission_key accepted_result]
      return if (previous_changes.keys & public_changes).empty?
    end
    Interviews::PublishSnapshotService.call(interview_id: is_a?(InterviewSession) ? id : interview_session_id)
  end
end

# Broadcasts committed public state. Delivery failure leaves durable data available
# through a fresh query or subscription reconnect instead of undoing accepted work.
module Interviews
  class PublishSnapshotService < ApplicationService
    def initialize(interview_id:)
      @interview_id = interview_id
    end

    def call
      interview = InterviewSession.find_by(id: @interview_id)
      return success(nil) unless interview
      ApiSchema.subscriptions.trigger(:interview_session_updated, { id: interview.id }, interview)
      success(nil)
    rescue StandardError => error
      Rails.logger.warn("Interview snapshot delivery failed: #{error.class}")
      failure("Snapshot delivery unavailable")
    end
  end
end

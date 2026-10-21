# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewSessionOperationType < Types::BaseObject
    field :can_retry, Boolean, null: false
    field :checkpoint, String, null: true
    field :submission_key, String, null: true
    field :id, ID, null: false
    field :question_id, ID, null: true
    field :message_id, ID, null: true
    field :kind, String, null: false
    field :status, String, null: false
    field :failure_code, String, null: true

    def can_retry
      Interviews::RetryEligibilityService.call(operation: object).success?
    end
  end
end

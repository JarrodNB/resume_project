# Safe progress and saved references for a current interviewer prompt.
module Types
  class InterviewCareerReferencesType < Types::BaseObject
    field :id, ID, null: false
    field :status, String, null: false
    field :references, [Types::CareerReferenceType], null: false
    field :can_retry, Boolean, null: false
    field :attempt_count, Integer, null: false
    field :ai_task_id, ID, null: true
    field :deadline, GraphQL::Types::ISO8601DateTime, null: true

    def can_retry = object.retry_count < 1

    def status
      return object.references.empty? ? "empty" : "completed" if object.ai_task&.completed?
      return "failed" if object.ai_task&.failed? || (object.deadline && object.deadline <= Time.current)
      object.claimed_at ? "running" : "queued"
    end
  end
end

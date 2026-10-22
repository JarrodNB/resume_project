# Public state for one prompt explanation. Claims and provider identity remain private.
module Types
  class InterviewClarificationType < Types::BaseObject
    field :id, ID, null: false
    field :status, String, null: false
    field :explanation, String, null: true
    field :attempt_count, Integer, null: false
    field :ai_task_id, ID, null: true
    field :deadline, GraphQL::Types::ISO8601DateTime, null: true

    def status
      return "completed" if object.explanation.present?
      return "failed" if object.ai_task&.failed? || (object.deadline && object.deadline <= Time.current)
      object.claimed_at ? "running" : "queued"
    end
  end
end

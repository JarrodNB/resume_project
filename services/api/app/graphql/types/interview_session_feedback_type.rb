# Safe saved coaching state. Execution claims and provider history are never public.
module Types
  class InterviewSessionFeedbackType < Types::BaseObject
    field :id, ID, null: false
    field :status, String, null: false
    field :content, GraphQL::Types::JSON, null: false
    field :attempt_count, Integer, null: false
    field :ai_task_id, ID, null: true
    field :deadline, GraphQL::Types::ISO8601DateTime, null: true

    def status
      return "completed" if object.content.present?
      return "failed" if object.ai_task&.failed? || (object.deadline && object.deadline <= Time.current)
      object.claimed_at ? "running" : "queued"
    end
  end
end

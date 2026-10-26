# Private task outcomes for the authenticated owner. The channel refreshes the initial
# baseline after its pubsub streams confirm, without replaying historical outcomes.
module Subscriptions
  class AiTaskFinished < BaseSubscription
    subscription_scope :current_user_id
    type Types::AiTaskOutcomeFeedType, null: false

    def subscribe
      raise GraphQL::ExecutionError, "Authentication required" unless current_user
      context[:task_outcome_handshake] = true
      { cursor: (current_user.ai_task_outcomes.maximum(:sequence) || 0).to_s, outcome: nil }
    end

    def update
      object
    end
  end
end

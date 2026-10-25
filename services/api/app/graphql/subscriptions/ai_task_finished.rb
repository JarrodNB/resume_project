# Private task outcomes for the authenticated owner. A baseline message confirms that
# registration is complete without replaying historical successes and failures.
module Subscriptions
  class AiTaskFinished < BaseSubscription
    subscription_scope :current_user_id
    type Types::AiTaskOutcomeFeedType, null: false

    def subscribe
      raise GraphQL::ExecutionError, "Authentication required" unless current_user
      { cursor: (current_user.ai_task_outcomes.maximum(:sequence) || 0).to_s, outcome: nil }
    end

    def update
      object
    end
  end
end

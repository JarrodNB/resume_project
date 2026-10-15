# frozen_string_literal: true

# Description: Root subscription fields, delivered over ActionCable.
# Index:
#   - ai_task_updated(id:): pushes an AI task whenever a result is applied to it
#   - ai_usage_updated(user_id:): owner-only known spend and incomplete accounting
module Types
  class SubscriptionType < Types::BaseObject
    field :ai_task_updated, subscription: Subscriptions::AiTaskUpdated
    field :ai_usage_updated, subscription: Subscriptions::AiUsageUpdated
  end
end

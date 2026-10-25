# frozen_string_literal: true

# Description: Root subscription fields, delivered over ActionCable.
# Index:
#   - ai_task_updated(id:): pushes an AI task whenever a result is applied to it
module Types
  class SubscriptionType < Types::BaseObject
    field :interview_session_updated, subscription: Subscriptions::InterviewSessionUpdated
    field :ai_task_finished, subscription: Subscriptions::AiTaskFinished
    field :ai_task_updated, subscription: Subscriptions::AiTaskUpdated
  end
end

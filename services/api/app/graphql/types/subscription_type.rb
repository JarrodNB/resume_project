# frozen_string_literal: true

# Description: Root subscription fields, delivered over ActionCable.
# Index:
#   - ai_task_updated(id:): pushes an AI task whenever a result is applied to it
module Types
  class SubscriptionType < Types::BaseObject
    field :ats_report_updated, subscription: Subscriptions::AtsReportUpdated
    field :ai_task_updated, subscription: Subscriptions::AiTaskUpdated
  end
end

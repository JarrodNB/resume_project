# Description: Live known monthly spend and incomplete accounting for the signed-in user.
# Index:
#   - subscribe: authorizes and sends current totals
#   - update: refreshes the owner's summary after an attempt report is recorded
module Subscriptions
  class AiUsageUpdated < BaseSubscription
    argument :user_id, ID, required: true
    type Types::AiUsageType, null: false

    # Only the owner can open this usage stream.
    def subscribe(user_id:)
      raise ActiveRecord::RecordNotFound unless current_user.id == user_id

      AiUsage::SummarizeMonthlyAiUsageService.call(user: current_user).value
    end

    # Rechecks ownership and computes current totals, including late attempt charges.
    def update(user_id:)
      subscribe(user_id: user_id)
    end
  end
end

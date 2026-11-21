# Copies one Stripe subscription's current state onto the user's billing row.
#
# Always asks Stripe for the subscription as it is now, so duplicate or out-of-order webhooks
# end in the same, correct state. The row is found by Stripe customer (falling back to the
# user id stored in the subscription's metadata). An unknown customer is logged and skipped.
# An old canceled subscription never overwrites a newer one that is still paid.
module Billing
  class SyncSubscriptionService < ApplicationService
    def initialize(subscription_id:, gateway: Gateway.current)
      @subscription_id = subscription_id
      @gateway = gateway
    end

    def call
      fetched = @gateway.retrieve_subscription(@subscription_id)
      row = find_row(fetched)
      unless row
        Rails.logger.warn("Stripe subscription #{fetched.id} matches no billing row; skipping sync")
        return success(nil)
      end

      row.with_lock do
        paid = BillingSubscription::PAID_STATUSES
        if row.stripe_subscription_id.present? && row.stripe_subscription_id != fetched.id &&
            row.status.in?(paid) && !fetched.status.in?(paid)
          next
        end
        row.update!(stripe_subscription_id: fetched.id, status: fetched.status,
          current_period_end: fetched.current_period_end, cancel_at_period_end: fetched.cancel_at_period_end)
      end
      success(row)
    end

    private

    def find_row(fetched)
      row = BillingSubscription.find_by(stripe_customer_id: fetched.customer_id)
      return row if row

      user = User.find_by(id: fetched.user_id) if fetched.user_id.present?
      return unless user
      user.billing_subscription || user.create_billing_subscription!(stripe_customer_id: fetched.customer_id)
    end
  end
end

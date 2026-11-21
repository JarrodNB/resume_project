# Copies one Stripe subscription's current state onto the user's billing row.
#
# Asks Stripe for the subscription as it is now, so duplicate or out-of-order webhooks end in the
# same, correct state. The row is found by Stripe customer (falling back to the user id stored in
# the subscription's metadata); an unknown customer is logged and skipped, unless its metadata names a user who no longer exists (a deleted account): then it is cancelled and a warning says to refund it. The state that gets
# written is fetched again after the row is locked, so two jobs running at once cannot leave
# older state behind. Guards: an old canceled subscription never overwrites a newer one that is
# still paid, and if a second paid subscription turns up (two checkouts at once) the row keeps the
# first, the newcomer is cancelled right away, and a warning names both ids so someone can refund it.
module Billing
  class SyncSubscriptionService < ApplicationService
    def initialize(subscription_id:, gateway: Gateway.current)
      @subscription_id = subscription_id
      @gateway = gateway
    end

    def call
      located = @gateway.retrieve_subscription(@subscription_id)
      row = find_row(located)
      unless row
        handle_unmatched(located)
        return success(nil)
      end

      duplicate = row.with_lock { apply_latest_state(row) }
      cancel_duplicate(duplicate, kept: row.stripe_subscription_id) if duplicate
      success(row)
    end

    private

    # Runs inside the row lock. Returns the duplicate paid subscription's id when one must be cancelled.
    def apply_latest_state(row)
      fetched = @gateway.retrieve_subscription(@subscription_id)
      paid = BillingSubscription::PAID_STATUSES
      other_paid_held = row.stripe_subscription_id.present? && row.stripe_subscription_id != fetched.id && row.status.in?(paid)
      return fetched.id if other_paid_held && fetched.status.in?(paid)
      return if other_paid_held

      row.update!(stripe_subscription_id: fetched.id, status: fetched.status,
        current_period_end: fetched.current_period_end, cancel_at_period_end: fetched.cancel_at_period_end)
      nil
    end

    def cancel_duplicate(duplicate_id, kept:)
      Rails.logger.warn("Duplicate paid Stripe subscription #{duplicate_id} arrived while #{kept} is kept; cancelling #{duplicate_id}. Refund it if the customer was charged.")
      @gateway.cancel_subscription_now(duplicate_id)
    end

    # No row to update. If the subscription names a user that no longer exists, the account was
    # deleted and this is a late checkout, so end it now. With no user named, just log and skip.
    def handle_unmatched(fetched)
      if fetched.user_id.present? && !Gateway::ENDED_STATUSES.include?(fetched.status)
        Rails.logger.warn("Stripe subscription #{fetched.id} belongs to a deleted account (user #{fetched.user_id}); cancelling it. Refund it if the customer was charged.")
        @gateway.cancel_subscription_now(fetched.id)
      else
        Rails.logger.warn("Stripe subscription #{fetched.id} matches no billing row; skipping sync")
      end
    end

    def find_row(fetched)
      row = BillingSubscription.find_by(stripe_customer_id: fetched.customer_id)
      return row if row

      user = User.find_by(id: fetched.user_id) if fetched.user_id.present?
      return unless user
      user.billing_subscription || user.create_billing_subscription!(stripe_customer_id: fetched.customer_id)
    end
  end
end

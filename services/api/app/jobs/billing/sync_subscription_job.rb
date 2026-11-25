# Description: Background sync of one Stripe subscription onto the user's billing row.
# Enqueued by the Stripe webhook with only the subscription id; the service fetches the
# current state from Stripe, so running it twice (or late) is safe. Stripe has already
# had its 200, so a lost sync is never redelivered: temporary Stripe failures are retried for
# about two days (16 attempts; polynomial waits of n**4 + 2 seconds add up to ~49.5 hours).
# A subscription Stripe no longer has is logged and dropped.
# Index:
#   - perform(subscription_id): runs Billing::SyncSubscriptionService
module Billing
  class SyncSubscriptionJob < ApplicationJob
    queue_as :default

    retry_on Gateway::Unavailable, wait: :polynomially_longer, attempts: 16

    def perform(subscription_id)
      SyncSubscriptionService.call(subscription_id: subscription_id)
    rescue Gateway::NotFound
      Rails.logger.warn("Stripe no longer has subscription #{subscription_id}; dropping its sync job")
    end
  end
end

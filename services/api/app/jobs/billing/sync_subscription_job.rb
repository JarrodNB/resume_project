# Description: Background sync of one Stripe subscription onto the user's billing row.
# Enqueued by the Stripe webhook with only the subscription id; the service fetches the
# current state from Stripe, so running it twice (or late) is safe. Temporary Stripe
# failures are retried.
# Index:
#   - perform(subscription_id): runs Billing::SyncSubscriptionService
module Billing
  class SyncSubscriptionJob < ApplicationJob
    queue_as :default

    retry_on Gateway::Unavailable, wait: :polynomially_longer, attempts: 5

    def perform(subscription_id)
      SyncSubscriptionService.call(subscription_id: subscription_id)
    end
  end
end

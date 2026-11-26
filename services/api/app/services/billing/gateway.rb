# The shared pieces of the payment-provider seam: plain values, errors, and which adapter is in use.
#
# Billing code talks to `Billing::Gateway.current`, never to the Stripe gem directly. In
# production that is Billing::StripeGateway; the test environment points
# `config.x.billing_gateway` at an in-memory fake, so specs never call Stripe.
# Every adapter answers: configured? (secret key set), checkout_configured? (also the price id), create_customer, create_checkout_session,
# create_portal_session, retrieve_subscription, live_subscription_ids, cancel_subscription_now,
# cancel_customer_subscriptions, expire_open_checkout_sessions, refund_subscription_payments, retrieve_price, construct_event.
# Index:
#   - Subscription: a subscription's current state (status, period end, cancel flag, user id and source marker from metadata)
#   - Price: the plan price (amount in the currency's smallest unit, ISO currency, billing interval)
#   - Event: a verified webhook event reduced to its type and subscription id
#   - InvalidSignature: raised by construct_event for a missing or wrong signature
#   - Unavailable: the provider could not do the call (network, rate limit, auth, any other provider error)
#   - NotFound: the provider says the thing asked about does not exist
#   - current: the adapter instance to use
module Billing
  module Gateway
    # The value Careerdrafter writes to `source` in the metadata of every subscription it starts, so
    # we can tell our own subscriptions from any other subscription on the same Stripe account.
    SOURCE = "careerdrafter"

    # `source` is the metadata marker above, or nil for a subscription we did not start.
    Subscription = Data.define(:id, :customer_id, :status, :current_period_end, :cancel_at_period_end, :user_id, :source) do
      def initialize(source: nil, **rest) = super
    end
    Event = Data.define(:type, :subscription_id)
    Price = Data.define(:unit_amount, :currency, :interval)

    # Subscription statuses that are over for good; there is nothing left to cancel.
    ENDED_STATUSES = %w[canceled incomplete_expired].freeze

    class InvalidSignature < StandardError; end
    # Adapters turn their provider's errors into these two, so callers never name a provider's classes.
    class Unavailable < StandardError; end
    class NotFound < StandardError; end

    # The adapter class name comes from Rails config so each environment picks it once.
    def self.current
      Rails.application.config.x.billing_gateway.constantize.new
    end
  end
end

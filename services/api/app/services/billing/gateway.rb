# The shared pieces of the payment-provider seam: plain values, errors, and which adapter is in use.
#
# Billing code talks to `Billing::Gateway.current`, never to the Stripe gem directly. In
# production that is Billing::StripeGateway; the test environment points
# `config.x.billing_gateway` at an in-memory fake, so specs never call Stripe.
# Every adapter answers: configured?, create_customer, create_checkout_session,
# create_portal_session, retrieve_subscription, cancel_subscription_now, construct_event.
# Index:
#   - Subscription: a subscription's current state (status, period end, cancel flag, user id from metadata)
#   - Event: a verified webhook event reduced to its type and subscription id
#   - InvalidSignature: raised by construct_event for a missing or wrong signature
#   - current: the adapter instance to use
module Billing
  module Gateway
    Subscription = Data.define(:id, :customer_id, :status, :current_period_end, :cancel_at_period_end, :user_id)
    Event = Data.define(:type, :subscription_id)

    class InvalidSignature < StandardError; end

    # The adapter class name comes from Rails config so each environment picks it once.
    def self.current
      Rails.application.config.x.billing_gateway.constantize.new
    end
  end
end

# Receives Stripe's webhooks at POST /billing/stripe/webhook.
#
# Public and machine-to-machine: no browser session or CSRF, so it inherits ActionController::API
# directly. The only thing that proves a request is from Stripe is the signature on the raw body,
# checked through the gateway. Valid events only queue a sync job holding the subscription id
# (the job asks Stripe for the real state), then we answer 200 fast. Other event types get 200 and are ignored.
module Billing
  class StripeWebhooksController < ActionController::API
    def create
      event = Gateway.current.construct_event(request.raw_post, request.headers["Stripe-Signature"])
      SyncSubscriptionJob.perform_later(event.subscription_id) if event&.subscription_id.present?
      head :ok
    rescue Gateway::InvalidSignature
      head :bad_request
    end
  end
end

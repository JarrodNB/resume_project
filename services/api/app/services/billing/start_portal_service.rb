# Opens the Stripe Customer Portal for a user who has a Stripe customer, and returns its URL.
#
# In the portal they can update their card, see invoices or cancel at period end. Never creates a
# customer: a user who never started checkout has nothing to manage. If Stripe isn't set up or can't
# be reached, returns a plain user-facing error instead of raising. Needs the gateway keys, so
# `configured?` (which also wants the price id) must be true.
module Billing
  class StartPortalService < ApplicationService
    UNAVAILABLE = "Billing isn't available right now."

    def initialize(user:, gateway: Gateway.current)
      @user = user
      @gateway = gateway
    end

    def call
      return failure([ UNAVAILABLE ]) unless @gateway.configured?

      customer_id = @user.billing_subscription&.stripe_customer_id
      return failure([ "You don't have any billing to manage yet." ]) if customer_id.blank?

      base = ENV.fetch("WEB_APP_URL", "http://localhost:5173").delete_suffix("/")
      success(@gateway.create_portal_session(customer_id: customer_id, return_url: "#{base}/account/billing"))
    rescue Gateway::Unavailable, Gateway::NotFound => error
      Rails.logger.error("Stripe portal failed for user #{@user.id}: #{error.class}")
      failure([ UNAVAILABLE ])
    end
  end
end

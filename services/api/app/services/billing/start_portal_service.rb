# Opens the Stripe Customer Portal for a user who has a Stripe customer, and returns its URL.
#
# In the portal they can update their card, see invoices or cancel at period end. Never creates a
# customer: a user who never started checkout has nothing to manage. If Stripe isn't set up or can't
# be reached, returns a plain user-facing error instead of raising. Needs only the Stripe secret key
# (`configured?`), not the checkout price id.
module Billing
  class StartPortalService < ApplicationService
    def initialize(user:, gateway: Gateway.current)
      @user = user
      @gateway = gateway
    end

    def call
      return failure([ BillingPage::UNAVAILABLE ]) unless @gateway.configured?

      customer_id = @user.billing_subscription&.stripe_customer_id
      return failure([ "You don't have any billing to manage yet." ]) if customer_id.blank?

      success(@gateway.create_portal_session(customer_id: customer_id, return_url: BillingPage.url))
    rescue Gateway::Unavailable, Gateway::NotFound => error
      Rails.logger.error("Stripe portal failed for user #{@user.id}: #{error.class}")
      failure([ BillingPage::UNAVAILABLE ])
    end
  end
end

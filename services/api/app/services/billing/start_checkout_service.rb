# Starts a Stripe Checkout for a user who wants to subscribe, and returns the Checkout URL.
#
# Refuses if the user is already paid. Creates the user's Stripe customer once (kept on their
# billing row, under a user row lock so double clicks can't make two) and reuses it after that.
# Needs the Stripe key and price id (`checkout_configured?`). If Stripe isn't set up or can't be reached, returns a plain user-facing error instead of raising.
module Billing
  class StartCheckoutService < ApplicationService
    def initialize(user:, gateway: Gateway.current)
      @user = user
      @gateway = gateway
    end

    def call
      return failure([ BillingPage::UNAVAILABLE ]) unless @gateway.checkout_configured?

      customer_id = customer_id_for_unpaid_user
      return failure([ "You're already subscribed." ]) unless customer_id

      success(@gateway.create_checkout_session(customer_id: customer_id, user_id: @user.id,
        success_url: BillingPage.url(checkout: "success"), cancel_url: BillingPage.url))
    rescue Gateway::Unavailable, Gateway::NotFound => error
      Rails.logger.error("Stripe checkout failed for user #{@user.id}: #{error.class}")
      failure([ BillingPage::UNAVAILABLE ])
    end

    private

    # Nil when the user is already paid. The lock keeps two clicks from creating two customers.
    def customer_id_for_unpaid_user
      @user.with_lock do
        row = @user.billing_subscription
        next if row&.status.in?(BillingSubscription::PAID_STATUSES)
        row ||= @user.create_billing_subscription!(stripe_customer_id: @gateway.create_customer(@user))
        row.stripe_customer_id
      end
    end
  end
end

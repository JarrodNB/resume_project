# Starts a Stripe Checkout for a user who wants to subscribe, and returns the Checkout URL.
#
# Refuses if the user is already paid. Creates the user's Stripe customer once (kept on their
# billing row; Stripe is called with no lock held, and the row's unique user index settles double clicks) and reuses it after that.
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

    # Nil when the user is already paid. Stripe is called with no lock held. Two clicks may both
    # make the customer (Stripe's idempotency key gives them the same one); the unique index on the
    # user lets only one row in, and the loser uses that row.
    def customer_id_for_unpaid_user
      row = BillingSubscription.find_by(user_id: @user.id)
      return if row&.paid?
      return row.stripe_customer_id if row

      customer_id = @gateway.create_customer(@user)
      row = save_customer_row(customer_id)
      row.paid? ? nil : row.stripe_customer_id
    end

    def save_customer_row(customer_id)
      BillingSubscription.transaction(requires_new: true) { BillingSubscription.create!(user: @user, stripe_customer_id: customer_id) }
    rescue ActiveRecord::RecordNotUnique
      BillingSubscription.find_by!(user_id: @user.id)
    end
  end
end

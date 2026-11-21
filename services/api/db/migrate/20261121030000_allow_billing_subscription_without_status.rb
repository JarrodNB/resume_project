# A billing row now exists as soon as a user starts Checkout (it holds their Stripe customer),
# before any subscription exists, so status can be empty. An empty status is never "paid".
class AllowBillingSubscriptionWithoutStatus < ActiveRecord::Migration[8.1]
  def change
    change_column_null :billing_subscriptions, :status, true
  end
end

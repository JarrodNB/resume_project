# Description: A paid (active) subscription for a user. Override status for other states.
FactoryBot.define do
  factory :billing_subscription do
    user
    sequence(:stripe_customer_id) { |n| "cus_test_#{n}" }
    sequence(:stripe_subscription_id) { |n| "sub_test_#{n}" }
    status { "active" }
    current_period_end { 30.days.from_now }
    cancel_at_period_end { false }
  end
end

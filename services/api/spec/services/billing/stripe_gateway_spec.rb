# The Stripe adapter turns Stripe's objects into plain values; no network calls are made here.
require "rails_helper"

RSpec.describe Billing::StripeGateway do
  it "reads current_period_end from the subscription items in recent API versions" do
    stripe_subscription = Stripe::Subscription.construct_from(
      id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: true, metadata: { user_id: "u1" },
      items: { object: "list", data: [ { id: "si_1", current_period_end: 1_800_000_000 }, { id: "si_2", current_period_end: 1_800_000_500 } ] }
    )

    expect(described_class.subscription_from(stripe_subscription)).to eq(
      Billing::Gateway::Subscription.new(id: "sub_1", customer_id: "cus_1", status: "active",
        current_period_end: Time.zone.at(1_800_000_500), cancel_at_period_end: true, user_id: "u1")
    )
  end

  it "prefers a top-level current_period_end when Stripe sends one" do
    stripe_subscription = Stripe::Subscription.construct_from(id: "sub_1", customer: { id: "cus_1" }, status: "past_due", current_period_end: 1_700_000_000)

    expect(described_class.subscription_from(stripe_subscription)).to have_attributes(customer_id: "cus_1", current_period_end: Time.zone.at(1_700_000_000), cancel_at_period_end: false, user_id: nil)
  end

  it "reports whether checkout can run from its settings" do
    stub_const("ENV", ENV.to_hash.merge("STRIPE_SECRET_KEY" => "sk_test_x", "STRIPE_PRICE_ID" => "price_1"))
    expect(described_class.new.configured?).to be(true)

    stub_const("ENV", ENV.to_hash.merge("STRIPE_SECRET_KEY" => "", "STRIPE_PRICE_ID" => "price_1"))
    expect(described_class.new.configured?).to be(false)
  end
end

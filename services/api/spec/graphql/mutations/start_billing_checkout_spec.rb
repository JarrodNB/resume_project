# startBillingCheckout sends trial and ended users to Stripe Checkout, once per customer, and refuses paid users.
require "rails_helper"

RSpec.describe "startBillingCheckout mutation" do
  include GraphqlHelpers
  let(:mutation) { "mutation { startBillingCheckout(input: {}) { url errors } }" }
  let(:user) { create(:user, trial_ends_at: 3.days.from_now) }

  def start(for_user = user) = execute_graphql(mutation, user: for_user).dig("data", "startBillingCheckout")

  it "returns a Checkout URL for a trial user and remembers the Stripe customer" do
    payload = start

    expect(payload).to eq("url" => "https://checkout.stripe.test/session/1", "errors" => [])
    row = user.reload.billing_subscription
    expect(row.stripe_customer_id).to eq("cus_fake_1")
    expect(row.status).to be_nil
    expect(FakeStripeGateway.checkout_sessions.last).to include(
      customer_id: "cus_fake_1", user_id: user.id,
      success_url: "http://localhost:5173/account/billing?checkout=success", cancel_url: "http://localhost:5173/account/billing"
    )
  end

  it "works for a user whose trial has ended" do
    ended = create(:user, trial_ends_at: 2.days.ago)

    expect(start(ended)["url"]).to be_present
  end

  it "creates the Stripe customer once and reuses it on later clicks" do
    start
    start

    expect(FakeStripeGateway.customers_created).to eq([ user.id ])
    expect(FakeStripeGateway.checkout_sessions.map { |session| session[:customer_id] }).to eq(%w[cus_fake_1 cus_fake_1])
  end

  it "does not treat a customer-only row as a paid plan" do
    start

    expect(Billing::ResolvePlanService.call(user: user.reload).value.plan).to eq("trial")
    expect(BillingSubscription.paid).to be_empty
  end

  it "refuses a user who is already paid" do
    create(:billing_subscription, user: user, status: "active")

    expect(start).to eq("url" => nil, "errors" => [ "You're already subscribed." ])
    expect(FakeStripeGateway.checkout_sessions).to be_empty
  end

  it "says billing is unavailable when Stripe isn't configured" do
    FakeStripeGateway.configured = false

    expect(start).to eq("url" => nil, "errors" => [ "Billing isn't available right now." ])
    expect(user.reload.billing_subscription).to be_nil
  end

  it "says billing is unavailable when Stripe errors" do
    FakeStripeGateway.checkout_error = Billing::Gateway::Unavailable.new("down")

    expect(start).to eq("url" => nil, "errors" => [ "Billing isn't available right now." ])
  end
end

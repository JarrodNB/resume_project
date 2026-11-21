# startBillingPortal sends a user with a Stripe customer to the Stripe Customer Portal, and refuses everyone else.
require "rails_helper"

RSpec.describe "startBillingPortal mutation" do
  include GraphqlHelpers
  let(:mutation) { "mutation { startBillingPortal(input: {}) { url errors } }" }
  let(:user) { create(:user, trial_ends_at: 3.days.from_now) }

  def start(for_user = user) = execute_graphql(mutation, user: for_user).dig("data", "startBillingPortal")

  it "returns a portal URL for the user's Stripe customer" do
    create(:billing_subscription, user: user, stripe_customer_id: "cus_mine")

    expect(start).to eq("url" => "https://billing.stripe.test/portal/1", "errors" => [])
    expect(FakeStripeGateway.portal_sessions.last).to eq(customer_id: "cus_mine", return_url: "http://localhost:5173/account/billing")
  end

  it "works for a user who has a customer but no live subscription" do
    create(:billing_subscription, user: user, status: "canceled")

    expect(start["url"]).to be_present
  end

  it "refuses a user with no Stripe customer, without creating one" do
    expect(start).to eq("url" => nil, "errors" => [ "You don't have any billing to manage yet." ])
    expect(FakeStripeGateway.portal_sessions).to be_empty
    expect(FakeStripeGateway.customers_created).to be_empty
  end

  it "says billing is unavailable when Stripe isn't configured" do
    create(:billing_subscription, user: user)
    FakeStripeGateway.configured = false

    expect(start).to eq("url" => nil, "errors" => [ "Billing isn't available right now." ])
  end

  it "says billing is unavailable when Stripe errors" do
    create(:billing_subscription, user: user)
    FakeStripeGateway.portal_error = Stripe::APIConnectionError.new("down")

    expect(start).to eq("url" => nil, "errors" => [ "Billing isn't available right now." ])
  end

  it "reports canManageBilling only for a user with a Stripe customer" do
    query = "{ me { billing { canManageBilling } } }"
    expect(execute_graphql(query, user: user).dig("data", "me", "billing", "canManageBilling")).to be(false)

    create(:billing_subscription, user: user)
    expect(execute_graphql(query, user: user.reload).dig("data", "me", "billing", "canManageBilling")).to be(true)
  end
end

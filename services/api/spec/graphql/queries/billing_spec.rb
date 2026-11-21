# The billing summary shows only the plan and its dates; never caps, spend, cap overrides or Stripe ids.
require "rails_helper"

RSpec.describe "me.billing query" do
  include GraphqlHelpers
  let(:query) { "{ me { billing { plan trialEndsAt currentPeriodEndsAt cancelAtPeriodEnd } } }" }

  def billing_for(user) = execute_graphql(query, user: user).dig("data", "me", "billing")

  it "shows a trial with its end date" do
    user = create(:user, trial_ends_at: 3.days.from_now.change(usec: 0))

    expect(billing_for(user)).to eq(
      "plan" => "TRIAL", "trialEndsAt" => user.trial_ends_at.iso8601,
      "currentPeriodEndsAt" => nil, "cancelAtPeriodEnd" => false
    )
  end

  it "shows a paid plan with its renewal date" do
    user = create(:user)
    subscription = create(:billing_subscription, user: user, current_period_end: 20.days.from_now.change(usec: 0))

    expect(billing_for(user)).to include("plan" => "PAID", "currentPeriodEndsAt" => subscription.current_period_end.iso8601, "cancelAtPeriodEnd" => false)
  end

  it "shows a paid plan that ends at the period end" do
    user = create(:user)
    create(:billing_subscription, user: user, cancel_at_period_end: true)

    expect(billing_for(user)).to include("plan" => "PAID", "cancelAtPeriodEnd" => true)
  end

  it "shows an ended plan" do
    expect(billing_for(create(:user, :trial_ended))).to include("plan" => "ENDED", "currentPeriodEndsAt" => nil)
  end

  it "shows the plan price read from Stripe" do
    price = execute_graphql("{ me { billing { priceLabel } } }", user: create(:user)).dig("data", "me", "billing", "priceLabel")

    expect(price).to eq("$12/month")
  end

  it "does not expose caps, spend, cap overrides or Stripe ids" do
    type = ApiSchema.types["Billing"]

    expect(type.fields.keys).to contain_exactly("plan", "trialEndsAt", "currentPeriodEndsAt", "cancelAtPeriodEnd", "canManageBilling", "priceLabel")
  end
end

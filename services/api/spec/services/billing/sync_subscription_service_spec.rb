# Syncing copies Stripe's current subscription state, and gives the same answer however webhooks arrive.
require "rails_helper"

RSpec.describe Billing::SyncSubscriptionService do
  let(:user) { create(:user, trial_ends_at: 3.days.from_now) }
  let!(:row) { create(:billing_subscription, user: user, stripe_customer_id: "cus_1", stripe_subscription_id: nil, status: nil, current_period_end: nil) }
  let(:period_end) { Time.zone.at(1_800_000_000) }

  def stripe_subscription(id: "sub_1", status: "active", customer_id: "cus_1", user_id: user.id, cancel: false)
    Billing::Gateway::Subscription.new(id: id, customer_id: customer_id, status: status, current_period_end: period_end,
      cancel_at_period_end: cancel, user_id: user_id)
  end

  def sync(id = "sub_1") = described_class.call(subscription_id: id)

  it "makes an active subscription the paid plan" do
    FakeStripeGateway.subscriptions["sub_1"] = stripe_subscription(cancel: true)

    sync

    expect(row.reload).to have_attributes(stripe_subscription_id: "sub_1", status: "active", current_period_end: period_end, cancel_at_period_end: true)
    expect(Billing::ResolvePlanService.call(user: user.reload).value.plan).to eq("paid")
  end

  it "gives the same result when run twice" do
    FakeStripeGateway.subscriptions["sub_1"] = stripe_subscription

    2.times { sync }

    expect(BillingSubscription.count).to eq(1)
    expect(row.reload).to have_attributes(stripe_subscription_id: "sub_1", status: "active")
  end

  it "ends with Stripe's current state when an older event arrives late" do
    FakeStripeGateway.subscriptions["sub_1"] = stripe_subscription(status: "incomplete")
    sync
    FakeStripeGateway.subscriptions["sub_1"] = stripe_subscription(status: "active")
    sync
    # A stale "incomplete" webhook is processed after the "active" one; Stripe still says active.
    sync

    expect(row.reload.status).to eq("active")
  end

  it "keeps a newer paid subscription when an old canceled one is synced" do
    FakeStripeGateway.subscriptions["sub_new"] = stripe_subscription(id: "sub_new", status: "active")
    FakeStripeGateway.subscriptions["sub_old"] = stripe_subscription(id: "sub_old", status: "canceled")
    sync("sub_new")

    sync("sub_old")

    expect(row.reload).to have_attributes(stripe_subscription_id: "sub_new", status: "active")
  end

  it "lets a newer subscription replace an old canceled one" do
    row.update!(stripe_subscription_id: "sub_old", status: "canceled")
    FakeStripeGateway.subscriptions["sub_new"] = stripe_subscription(id: "sub_new", status: "active")

    sync("sub_new")

    expect(row.reload).to have_attributes(stripe_subscription_id: "sub_new", status: "active")
  end

  it "does nothing for an unknown customer" do
    FakeStripeGateway.subscriptions["sub_x"] = stripe_subscription(id: "sub_x", customer_id: "cus_unknown", user_id: nil)

    expect(sync("sub_x")).to be_success
    expect(row.reload.status).to be_nil
  end

  it "falls back to the user id in the subscription metadata" do
    row.update!(stripe_customer_id: "cus_other")
    FakeStripeGateway.subscriptions["sub_1"] = stripe_subscription(customer_id: "cus_1")

    sync

    expect(row.reload.status).to eq("active")
  end
end

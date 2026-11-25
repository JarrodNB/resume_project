# The daily reconciliation queues a sync for every subscription Stripe or our row says is still live.
require "rails_helper"

RSpec.describe Billing::ReconcileSubscriptionsService do
  include ActiveJob::TestHelper

  let(:user) { create(:user) }

  def stripe_subscription(id, status: "active", customer_id: "cus_1")
    Billing::Gateway::Subscription.new(id: id, customer_id: customer_id, status: status, current_period_end: 1.month.from_now,
      cancel_at_period_end: false, user_id: user.id, source: Billing::Gateway::SOURCE)
  end

  def queued_ids
    enqueued_jobs.select { |job| job["job_class"] == "Billing::SyncSubscriptionJob" }.map { |job| job["arguments"].first }
  end

  it "finds a paid subscription whose webhook sync was lost and makes it the paid plan" do
    create(:billing_subscription, user: user, stripe_customer_id: "cus_1", stripe_subscription_id: nil, status: nil, current_period_end: nil)
    FakeStripeGateway.subscriptions["sub_new"] = stripe_subscription("sub_new")

    perform_enqueued_jobs { described_class.call }

    expect(Billing::ResolvePlanService.call(user: user.reload).value.plan).to eq("paid")
  end

  it "re-checks the recorded subscription even when Stripe lists it as ended" do
    create(:billing_subscription, user: user, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_old", status: "active")
    FakeStripeGateway.subscriptions["sub_old"] = stripe_subscription("sub_old", status: "canceled")

    perform_enqueued_jobs { described_class.call }

    expect(user.reload.billing_subscription.status).to eq("canceled")
  end

  it "skips ended subscriptions and rows that are already over" do
    create(:billing_subscription, user: user, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_done", status: "canceled")
    FakeStripeGateway.subscriptions["sub_done"] = stripe_subscription("sub_done", status: "canceled")

    expect(described_class.call.value).to eq(0)
    expect(queued_ids).to be_empty
  end

  it "keeps going when Stripe fails for one customer" do
    create(:billing_subscription, user: user, stripe_customer_id: "cus_1", stripe_subscription_id: nil, status: nil)
    other = create(:user)
    create(:billing_subscription, user: other, stripe_customer_id: "cus_2", stripe_subscription_id: nil, status: nil)
    FakeStripeGateway.subscriptions["sub_2"] = stripe_subscription("sub_2", customer_id: "cus_2")
    gateway = FakeStripeGateway.new
    allow(gateway).to receive(:live_subscription_ids).and_call_original
    allow(gateway).to receive(:live_subscription_ids).with("cus_1").and_raise(Billing::Gateway::Unavailable, "down")

    expect(described_class.call(gateway: gateway).value).to eq(1)
    expect(queued_ids).to eq([ "sub_2" ])
  end

  it "does nothing without a Stripe key" do
    create(:billing_subscription, user: user, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", status: "active")
    FakeStripeGateway.configured = false

    expect(described_class.call.value).to eq(0)
    expect(queued_ids).to be_empty
  end
end

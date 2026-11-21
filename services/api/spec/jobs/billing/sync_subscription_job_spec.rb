# The sync job runs the service for the given subscription id.
require "rails_helper"

RSpec.describe Billing::SyncSubscriptionJob do
  it "syncs the subscription named in the job" do
    user = create(:user)
    row = create(:billing_subscription, user: user, stripe_customer_id: "cus_1", stripe_subscription_id: nil, status: nil)
    FakeStripeGateway.subscriptions["sub_1"] = Billing::Gateway::Subscription.new(id: "sub_1", customer_id: "cus_1", status: "active",
      current_period_end: 30.days.from_now, cancel_at_period_end: false, user_id: user.id)

    described_class.perform_now("sub_1")

    expect(row.reload.status).to eq("active")
  end

  it "uses an existing queue" do
    expect(described_class.new.queue_name).to eq("default")
  end
end

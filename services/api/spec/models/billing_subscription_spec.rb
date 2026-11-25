# "Paid" has one definition, shared by stored rows, provider statuses and the SQL scope.
require "rails_helper"

RSpec.describe BillingSubscription do
  it "counts active and past_due as paid, everything else as not paid" do
    expect(%w[active past_due].map { described_class.paid_status?(_1) }).to all(be true)
    expect([ nil, "unpaid", "canceled", "incomplete", "incomplete_expired", "trialing" ].map { described_class.paid_status?(_1) }).to all(be false)
  end

  it "agrees between a row and the paid scope" do
    paid = create(:billing_subscription, status: "past_due")
    unpaid = create(:billing_subscription, status: "canceled")

    expect(paid).to be_paid
    expect(unpaid).not_to be_paid
    expect(described_class.paid).to contain_exactly(paid)
  end
end

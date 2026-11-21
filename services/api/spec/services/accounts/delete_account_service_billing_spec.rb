# Deleting an account cancels a live Stripe subscription first, and refuses to delete if Stripe can't be reached.
require "rails_helper"

RSpec.describe Accounts::DeleteAccountService do
  let(:password) { "a quiet orchard after rain" }
  let(:user) { create(:user) }
  let(:failure_message) { "We couldn't cancel your subscription, so your account wasn't deleted. Try again in a moment." }

  def delete_account = described_class.call(user: user, current_password: password)

  it "deletes a user with no billing row and never calls Stripe" do
    expect(delete_account).to be_success
    expect(User.exists?(user.id)).to be(false)
    expect(FakeStripeGateway.canceled).to be_empty
  end

  it "does not cancel when the password is wrong" do
    create(:billing_subscription, user: user, stripe_subscription_id: "sub_live")

    result = described_class.call(user: user, current_password: "nope nope nope nope")

    expect(result.success).to be(false)
    expect(FakeStripeGateway.canceled).to be_empty
    expect(User.exists?(user.id)).to be(true)
  end

  %w[active past_due unpaid incomplete trialing].each do |status|
    it "cancels a #{status} subscription in Stripe, then deletes" do
      create(:billing_subscription, user: user, stripe_subscription_id: "sub_live", status: status)

      expect(delete_account).to be_success
      expect(FakeStripeGateway.canceled).to eq([ "sub_live" ])
      expect(User.exists?(user.id)).to be(false)
    end
  end

  it "skips Stripe when the subscription is already canceled or expired" do
    row = create(:billing_subscription, user: user, stripe_subscription_id: "sub_old", status: "canceled")
    expect(delete_account).to be_success
    row2 = create(:billing_subscription, user: create(:user), stripe_subscription_id: "sub_exp", status: "incomplete_expired")
    expect(described_class.call(user: row2.user, current_password: password)).to be_success
    expect(FakeStripeGateway.canceled).to be_empty
    expect(row).to be_present
  end

  it "skips Stripe for a customer-only row (never subscribed)" do
    create(:billing_subscription, user: user, stripe_subscription_id: nil, status: nil)

    expect(delete_account).to be_success
    expect(FakeStripeGateway.canceled).to be_empty
  end

  it "keeps the account when Stripe can't cancel" do
    create(:billing_subscription, user: user, stripe_subscription_id: "sub_live")
    FakeStripeGateway.cancel_error = Billing::Gateway::Unavailable.new("down")

    result = delete_account

    expect(result.success).to be(false)
    expect(result.errors).to eq([ failure_message ])
    expect(User.exists?(user.id)).to be(true)
  end

  it "keeps the account when Stripe is not configured but a live subscription exists" do
    create(:billing_subscription, user: user, stripe_subscription_id: "sub_live")
    FakeStripeGateway.configured = false

    expect(delete_account.errors).to eq([ failure_message ])
    expect(User.exists?(user.id)).to be(true)
  end

  it "treats a subscription Stripe says is already gone as canceled" do
    create(:billing_subscription, user: user, stripe_subscription_id: "sub_live")
    FakeStripeGateway.cancel_error = Billing::Gateway::NotFound.new("No such subscription")

    expect(delete_account).to be_success
    expect(User.exists?(user.id)).to be(false)
  end
end

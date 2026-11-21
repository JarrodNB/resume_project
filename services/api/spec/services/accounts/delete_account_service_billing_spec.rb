# Deleting an account cancels every live Stripe subscription of the user's customer first, and refuses to delete if Stripe can't be reached.
require "rails_helper"

RSpec.describe Accounts::DeleteAccountService do
  let(:password) { "a quiet orchard after rain" }
  let(:user) { create(:user) }
  let(:failure_message) { "We couldn't cancel your subscription, so your account wasn't deleted. Try again in a moment." }

  def delete_account = described_class.call(user: user, current_password: password)

  def stripe_has(id, customer_id:, status: "active")
    FakeStripeGateway.subscriptions[id] = Billing::Gateway::Subscription.new(id: id, customer_id: customer_id, status: status,
      current_period_end: 30.days.from_now, cancel_at_period_end: false, user_id: user.id)
  end

  it "deletes a user with no billing row and never calls Stripe" do
    expect(delete_account).to be_success
    expect(User.exists?(user.id)).to be(false)
    expect(FakeStripeGateway.canceled).to be_empty
  end

  it "does not cancel when the password is wrong" do
    row = create(:billing_subscription, user: user, stripe_subscription_id: "sub_live")
    stripe_has("sub_live", customer_id: row.stripe_customer_id)

    result = described_class.call(user: user, current_password: "nope nope nope nope")

    expect(result.success).to be(false)
    expect(FakeStripeGateway.canceled).to be_empty
    expect(User.exists?(user.id)).to be(true)
  end

  %w[active past_due unpaid incomplete trialing].each do |status|
    it "cancels a #{status} subscription in Stripe, then deletes" do
      row = create(:billing_subscription, user: user, stripe_subscription_id: "sub_live", status: status)
      stripe_has("sub_live", customer_id: row.stripe_customer_id, status: status)

      expect(delete_account).to be_success
      expect(FakeStripeGateway.canceled).to eq([ "sub_live" ])
      expect(User.exists?(user.id)).to be(false)
    end
  end

  it "does not cancel subscriptions that have already ended" do
    row = create(:billing_subscription, user: user, stripe_subscription_id: "sub_old", status: "canceled")
    stripe_has("sub_old", customer_id: row.stripe_customer_id, status: "canceled")
    stripe_has("sub_exp", customer_id: row.stripe_customer_id, status: "incomplete_expired")

    expect(delete_account).to be_success
    expect(FakeStripeGateway.canceled).to be_empty
  end

  it "succeeds for a customer-only row (never subscribed)" do
    create(:billing_subscription, user: user, stripe_subscription_id: nil, status: nil)

    expect(delete_account).to be_success
    expect(FakeStripeGateway.canceled).to be_empty
  end

  it "cancels a subscription Stripe has for the customer even when the webhook sync never ran" do
    row = create(:billing_subscription, user: user, stripe_subscription_id: nil, status: nil)
    stripe_has("sub_unsynced", customer_id: row.stripe_customer_id)
    stripe_has("sub_someone_else", customer_id: "cus_other")

    expect(delete_account).to be_success
    expect(FakeStripeGateway.canceled).to eq([ "sub_unsynced" ])
    expect(User.exists?(user.id)).to be(false)
  end

  it "keeps the account when cancelling an unsynced subscription fails" do
    row = create(:billing_subscription, user: user, stripe_subscription_id: nil, status: nil)
    stripe_has("sub_unsynced", customer_id: row.stripe_customer_id)
    FakeStripeGateway.cancel_error = Billing::Gateway::Unavailable.new("down")

    expect(delete_account.errors).to eq([ failure_message ])
    expect(User.exists?(user.id)).to be(true)
  end

  it "keeps the account when Stripe can't cancel" do
    row = create(:billing_subscription, user: user, stripe_subscription_id: "sub_live")
    stripe_has("sub_live", customer_id: row.stripe_customer_id)
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
    row = create(:billing_subscription, user: user, stripe_subscription_id: "sub_live")
    stripe_has("sub_live", customer_id: row.stripe_customer_id)
    FakeStripeGateway.cancel_error = Billing::Gateway::NotFound.new("No such subscription")

    expect(delete_account).to be_success
    expect(User.exists?(user.id)).to be(false)
  end
end

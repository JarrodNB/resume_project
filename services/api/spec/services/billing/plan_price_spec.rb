# The shown plan price comes from the Stripe price Checkout charges.
require "rails_helper"

RSpec.describe Billing::PlanPrice do
  around do |example|
    original = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    example.run
  ensure
    Rails.cache = original
  end

  before { stub_const("ENV", ENV.to_hash.merge("STRIPE_PRICE_ID" => "price_test_1")) }

  def price(amount, currency: "usd", interval: "month") = Billing::Gateway::Price.new(unit_amount: amount, currency: currency, interval: interval)

  it "shows the Stripe price" do
    expect(described_class.label).to eq("$12/month")
  end

  it "follows a price change in Stripe" do
    FakeStripeGateway.price = price(1500)

    expect(described_class.label).to eq("$15/month")
  end

  it "formats cents and other currencies" do
    expect(described_class.format(price(1250))).to eq("$12.50/month")
    expect(described_class.format(price(1000, currency: "eur", interval: "year"))).to eq("10 EUR/year")
  end

  it "is nil without a price and tries again after Stripe fails" do
    FakeStripeGateway.checkout_configured = false
    expect(described_class.label).to be_nil

    FakeStripeGateway.checkout_configured = true
    FakeStripeGateway.price_error = Billing::Gateway::Unavailable.new("down")
    expect(described_class.label).to be_nil

    FakeStripeGateway.price_error = nil
    expect(described_class.label).to eq("$12/month")
  end
end

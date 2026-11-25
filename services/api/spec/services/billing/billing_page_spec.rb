# The billing page link and the shared "unavailable" message that checkout, portal and the trial email use.
require "rails_helper"

RSpec.describe Billing::BillingPage do
  around do |example|
    original = ENV["WEB_APP_URL"]
    example.run
  ensure
    ENV["WEB_APP_URL"] = original
  end

  it "points at /account/billing on the web app" do
    ENV["WEB_APP_URL"] = "https://app.example.test"

    expect(described_class.url).to eq("https://app.example.test/account/billing")
  end

  it "does not double the slash when WEB_APP_URL ends with one" do
    ENV["WEB_APP_URL"] = "https://app.example.test/"

    expect(described_class.url).to eq("https://app.example.test/account/billing")
  end

  it "falls back to the local web app and can add a query" do
    ENV.delete("WEB_APP_URL")

    expect(described_class.url(checkout: "success")).to eq("http://localhost:5173/account/billing?checkout=success")
  end
end

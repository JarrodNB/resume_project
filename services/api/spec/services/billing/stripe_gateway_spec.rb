# The Stripe adapter turns Stripe's objects into plain values; no network calls are made here.
require "rails_helper"

RSpec.describe Billing::StripeGateway do
  it "reads current_period_end from the subscription items in recent API versions" do
    stripe_subscription = Stripe::Subscription.construct_from(
      id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: true, metadata: { user_id: "u1", source: "careerdrafter" },
      items: { object: "list", data: [ { id: "si_1", current_period_end: 1_800_000_000 }, { id: "si_2", current_period_end: 1_800_000_500 } ] }
    )

    expect(described_class.subscription_from(stripe_subscription)).to eq(
      Billing::Gateway::Subscription.new(id: "sub_1", customer_id: "cus_1", status: "active",
        current_period_end: Time.zone.at(1_800_000_500), cancel_at_period_end: true, user_id: "u1", source: "careerdrafter")
    )
  end

  it "prefers a top-level current_period_end when Stripe sends one" do
    stripe_subscription = Stripe::Subscription.construct_from(id: "sub_1", customer: { id: "cus_1" }, status: "past_due", current_period_end: 1_700_000_000)

    expect(described_class.subscription_from(stripe_subscription)).to have_attributes(customer_id: "cus_1", current_period_end: Time.zone.at(1_700_000_000), cancel_at_period_end: false, user_id: nil, source: nil)
  end

  it "needs only the secret key for configured? (portal and cancel) but also the price id for checkout_configured?" do
    stub_const("ENV", ENV.to_hash.merge("STRIPE_SECRET_KEY" => "sk_test_x", "STRIPE_PRICE_ID" => ""))
    expect(described_class.new).to have_attributes(configured?: true, checkout_configured?: false)

    stub_const("ENV", ENV.to_hash.merge("STRIPE_SECRET_KEY" => "sk_test_x", "STRIPE_PRICE_ID" => "price_1"))
    expect(described_class.new).to have_attributes(configured?: true, checkout_configured?: true)

    stub_const("ENV", ENV.to_hash.merge("STRIPE_SECRET_KEY" => "", "STRIPE_PRICE_ID" => "price_1"))
    expect(described_class.new).to have_attributes(configured?: false, checkout_configured?: false)
  end

  describe "error translation" do
    let(:client) { instance_double(Stripe::StripeClient) }

    before do
      stub_const("ENV", ENV.to_hash.merge("STRIPE_SECRET_KEY" => "sk_test_x"))
      allow(Stripe::StripeClient).to receive(:new).and_return(client)
    end

    def stub_portal_call_raising(error)
      allow(client).to receive_message_chain(:v1, :billing_portal, :sessions, :create).and_raise(error)
    end

    [ Stripe::APIConnectionError.new("down"), Stripe::RateLimitError.new("slow down"), Stripe::AuthenticationError.new("bad key"),
      Stripe::InvalidRequestError.new("bad request", "id") ].each do |stripe_error|
      it "turns #{stripe_error.class} into Gateway::Unavailable" do
        stub_portal_call_raising(stripe_error)

        expect { described_class.new.create_portal_session(customer_id: "cus_1", return_url: "x") }.to raise_error(Billing::Gateway::Unavailable)
      end
    end

    it "turns a resource_missing error into Gateway::NotFound" do
      stub_portal_call_raising(Stripe::InvalidRequestError.new("No such customer", "customer", code: "resource_missing"))

      expect { described_class.new.create_portal_session(customer_id: "cus_1", return_url: "x") }.to raise_error(Billing::Gateway::NotFound)
    end

    it "cancels every not-yet-ended subscription of a customer" do
      subs = %w[active canceled incomplete incomplete_expired].map { |status| Stripe::Subscription.construct_from(id: "sub_#{status}", status: status) }
      listing = double(auto_paging_each: nil)
      allow(listing).to receive(:auto_paging_each) { |&block| subs.each(&block) }
      allow(client).to receive_message_chain(:v1, :subscriptions, :list).with({ customer: "cus_1", status: "all" }).and_return(listing)
      cancelled = []
      allow(client).to receive_message_chain(:v1, :subscriptions, :cancel) { |id| cancelled << id }

      expect(described_class.new.cancel_customer_subscriptions("cus_1")).to be_nil
      expect(cancelled).to eq(%w[sub_active sub_incomplete])
    end

    it "continues cancelling when a listed subscription has already disappeared" do
      subs = %w[sub_gone sub_live].map { |id| Stripe::Subscription.construct_from(id: id, status: "active") }
      listing = double(auto_paging_each: nil)
      allow(listing).to receive(:auto_paging_each) { |&block| subs.each(&block) }
      subscriptions = double("subscriptions", list: listing)
      allow(client).to receive_message_chain(:v1, :subscriptions).and_return(subscriptions)
      allow(subscriptions).to receive(:cancel).with("sub_gone")
        .and_raise(Stripe::InvalidRequestError.new("No such subscription", "id", code: "resource_missing"))
      expect(subscriptions).to receive(:cancel).with("sub_live")

      expect(described_class.new.cancel_customer_subscriptions("cus_1")).to be_nil
    end

    it "preserves a missing customer error from listing subscriptions" do
      allow(client).to receive_message_chain(:v1, :subscriptions, :list)
        .and_raise(Stripe::InvalidRequestError.new("No such customer", "customer", code: "resource_missing"))

      expect { described_class.new.cancel_customer_subscriptions("cus_1") }.to raise_error(Billing::Gateway::NotFound)
    end

    it "lists the ids of a customer's subscriptions that have not ended" do
      subs = %w[active canceled past_due incomplete_expired].map { |status| Stripe::Subscription.construct_from(id: "sub_#{status}", status: status) }
      listing = double(auto_paging_each: nil)
      allow(listing).to receive(:auto_paging_each) { |&block| subs.each(&block) }
      allow(client).to receive_message_chain(:v1, :subscriptions, :list).with({ customer: "cus_1", status: "all" }).and_return(listing)

      expect(described_class.new.live_subscription_ids("cus_1")).to eq(%w[sub_active sub_past_due])
    end

    it "translates errors from cancelling a subscription too" do
      allow(client).to receive_message_chain(:v1, :subscriptions, :cancel).and_raise(Stripe::APIConnectionError.new("down"))

      expect { described_class.new.cancel_subscription_now("sub_1") }.to raise_error(Billing::Gateway::Unavailable)
    end
  end

  describe "what is sent to Stripe" do
    let(:client) { instance_double(Stripe::StripeClient) }

    before do
      stub_const("ENV", ENV.to_hash.merge("STRIPE_SECRET_KEY" => "sk_test_x", "STRIPE_PRICE_ID" => "price_test_1"))
      allow(Stripe::StripeClient).to receive(:new).and_return(client)
    end

    # Captures the arguments of a Stripe client call chain and returns them with the stubbed result.
    def capture_call(*chain, result)
      sent = []
      allow(client).to receive_message_chain(*chain) { |*args, **kwargs| sent << [ args, kwargs ]; result }
      sent
    end

    it "reads the configured price" do
      price = Stripe::Price.construct_from(id: "price_test_1", unit_amount: 1200, currency: "usd", recurring: { interval: "month" })
      allow(client).to receive_message_chain(:v1, :prices, :retrieve).with("price_test_1").and_return(price)

      expect(described_class.new.retrieve_price).to eq(Billing::Gateway::Price.new(unit_amount: 1200, currency: "usd", interval: "month"))
    end

    it "makes a customer with the user's email and id, using an idempotency key per user" do
      user = create(:user)
      sent = capture_call(:v1, :customers, :create, double(id: "cus_1"))

      expect(described_class.new.create_customer(user)).to eq("cus_1")
      expect(sent).to eq([ [ [ { email: user.email, metadata: { user_id: user.id } }, { idempotency_key: "careerdrafter-customer-#{user.id}" } ], {} ] ])
    end

    it "starts a subscription checkout for the customer at the configured price" do
      sent = capture_call(:v1, :checkout, :sessions, :create, double(url: "https://checkout.stripe.test/s"))

      url = described_class.new.create_checkout_session(customer_id: "cus_1", user_id: "user-1", success_url: "https://app/ok", cancel_url: "https://app/no")

      expect(url).to eq("https://checkout.stripe.test/s")
      expect(sent.size).to eq(1)
      expect(sent.first.flatten.first).to eq(
        mode: "subscription", customer: "cus_1", line_items: [ { price: "price_test_1", quantity: 1 } ],
        client_reference_id: "user-1", subscription_data: { metadata: { user_id: "user-1", source: "careerdrafter" } },
        automatic_tax: { enabled: true }, customer_update: { address: "auto" },
        success_url: "https://app/ok", cancel_url: "https://app/no"
      )
    end

    it "opens the billing portal for the customer and returns to the given page" do
      sent = capture_call(:v1, :billing_portal, :sessions, :create, double(url: "https://billing.stripe.test/p"))

      expect(described_class.new.create_portal_session(customer_id: "cus_1", return_url: "https://app/billing")).to eq("https://billing.stripe.test/p")
      expect(sent.first.flatten.first).to eq(customer: "cus_1", return_url: "https://app/billing")
    end
  end
end

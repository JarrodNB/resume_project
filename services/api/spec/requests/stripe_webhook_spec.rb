# POST /billing/stripe/webhook only trusts correctly signed bodies and only queues a sync by subscription id.
require "rails_helper"

RSpec.describe "Stripe webhook", type: :request do
  let(:signature) { { "Stripe-Signature" => FakeStripeGateway::VALID_SIGNATURE } }

  def post_event(type, subscription_id, headers: signature)
    post "/billing/stripe/webhook", params: FakeStripeGateway.event_payload(type, subscription_id),
      headers: headers.merge("Content-Type" => "application/json")
  end

  it "queues a sync for a signed subscription event" do
    expect { post_event("customer.subscription.updated", "sub_1") }
      .to have_enqueued_job(Billing::SyncSubscriptionJob).with("sub_1")
    expect(response).to have_http_status(:ok)
  end

  it "takes the subscription id from a completed checkout session" do
    expect { post_event("checkout.session.completed", "sub_2") }
      .to have_enqueued_job(Billing::SyncSubscriptionJob).with("sub_2")
  end

  %w[customer.subscription.created customer.subscription.deleted].each do |type|
    it "handles #{type}" do
      expect { post_event(type, "sub_3") }.to have_enqueued_job(Billing::SyncSubscriptionJob).with("sub_3")
    end
  end

  it "rejects a wrong signature" do
    expect { post_event("customer.subscription.updated", "sub_1", headers: { "Stripe-Signature" => "nope" }) }
      .not_to have_enqueued_job(Billing::SyncSubscriptionJob)
    expect(response).to have_http_status(:bad_request)
  end

  it "rejects a missing signature" do
    expect { post_event("customer.subscription.updated", "sub_1", headers: {}) }
      .not_to have_enqueued_job(Billing::SyncSubscriptionJob)
    expect(response).to have_http_status(:bad_request)
  end

  it "answers 200 without queueing for event types it ignores" do
    expect { post_event("invoice.paid", "in_1") }.not_to have_enqueued_job(Billing::SyncSubscriptionJob)
    expect(response).to have_http_status(:ok)
  end

  it "does not need a browser session or CSRF token" do
    post_event("customer.subscription.updated", "sub_1")

    expect(response).not_to have_http_status(:unauthorized)
    expect(response).not_to have_http_status(:forbidden)
  end

  describe "with the real Stripe signature check" do
    let(:secret) { "whsec_test_secret" }
    let(:payload) { FakeStripeGateway.event_payload("customer.subscription.updated", "sub_9") }

    before do
      allow(Billing::Gateway).to receive(:current).and_return(Billing::StripeGateway.new)
      stub_const("ENV", ENV.to_hash.merge("STRIPE_WEBHOOK_SECRET" => secret))
    end

    def signed_header(body, signing_secret)
      timestamp = Time.now
      Stripe::Webhook::Signature.generate_header(timestamp, Stripe::Webhook::Signature.compute_signature(timestamp, body, signing_secret))
    end

    it "accepts a body signed with the webhook secret" do
      expect {
        post "/billing/stripe/webhook", params: payload,
          headers: { "Stripe-Signature" => signed_header(payload, secret), "Content-Type" => "application/json" }
      }.to have_enqueued_job(Billing::SyncSubscriptionJob).with("sub_9")
    end

    it "rejects a body signed with another secret" do
      post "/billing/stripe/webhook", params: payload,
        headers: { "Stripe-Signature" => signed_header(payload, "whsec_other"), "Content-Type" => "application/json" }

      expect(response).to have_http_status(:bad_request)
    end

    it "rejects a body changed after signing" do
      header = signed_header(payload, secret)
      post "/billing/stripe/webhook", params: payload.sub("sub_9", "sub_10"),
        headers: { "Stripe-Signature" => header, "Content-Type" => "application/json" }

      expect(response).to have_http_status(:bad_request)
    end
  end
end

# Description: An in-memory stand-in for Billing::StripeGateway, so specs never call Stripe.
# State is class-level (the app builds a new gateway per call); reset it before each example.
# Index:
#   - FakeStripeGateway.reset!: clears customers, subscriptions and recorded calls
#   - .configured: set false to simulate missing Stripe keys
#   - .subscriptions: id => Billing::Gateway::Subscription you want retrieve_subscription to return
#   - .customers_created, .checkout_sessions, .canceled: what the code under test asked for
#   - VALID_SIGNATURE: the only signature construct_event accepts
#   - .event_payload: a webhook JSON body for a given event type and subscription id
class FakeStripeGateway
  VALID_SIGNATURE = "fake-valid-signature"

  class << self
    attr_accessor :configured
    attr_reader :subscriptions, :customers_created, :checkout_sessions, :portal_sessions, :canceled

    def reset!
      @configured = true
      @subscriptions = {}
      @customers_created = []
      @checkout_sessions = []
      @portal_sessions = []
      @canceled = []
    end

    # A webhook body shaped like Stripe's for the event types the app handles.
    def event_payload(type, subscription_id)
      object = type == "checkout.session.completed" ? { id: "cs_test_1", object: "checkout.session", subscription: subscription_id } : { id: subscription_id, object: "subscription" }
      { id: "evt_test_1", object: "event", type: type, data: { object: object } }.to_json
    end
  end
  reset!

  def configured? = self.class.configured

  def create_customer(user)
    self.class.customers_created << user.id
    "cus_fake_#{self.class.customers_created.size}"
  end

  def create_checkout_session(customer_id:, user_id:, success_url:, cancel_url:)
    self.class.checkout_sessions << { customer_id: customer_id, user_id: user_id, success_url: success_url, cancel_url: cancel_url }
    "https://checkout.stripe.test/session/#{self.class.checkout_sessions.size}"
  end

  def create_portal_session(customer_id:, return_url:)
    self.class.portal_sessions << { customer_id: customer_id, return_url: return_url }
    "https://billing.stripe.test/portal/#{self.class.portal_sessions.size}"
  end

  def retrieve_subscription(subscription_id) = self.class.subscriptions.fetch(subscription_id)

  def cancel_subscription_now(subscription_id)
    self.class.canceled << subscription_id
    nil
  end

  def construct_event(payload, signature_header)
    raise Billing::Gateway::InvalidSignature, "bad signature" unless signature_header == VALID_SIGNATURE
    Billing::StripeGateway.event_from(Stripe::Event.construct_from(JSON.parse(payload)))
  rescue JSON::ParserError => error
    raise Billing::Gateway::InvalidSignature, error.message
  end
end

RSpec.configure { |config| config.before { FakeStripeGateway.reset! } }

# Description: An in-memory stand-in for Billing::StripeGateway, so specs never call Stripe.
# State is class-level (the app builds a new gateway per call); reset it before each example.
# Index:
#   - cancel_customer_subscriptions: cancels (and records) that customer's live subscriptions
#   - FakeStripeGateway.reset!: clears customers, subscriptions and recorded calls
#   - .configured: set false to simulate a missing Stripe secret key; .checkout_configured: false for a missing price id
#   - .checkout_error, .portal_error, .cancel_error: set to a Billing::Gateway error to make that call raise it
#   - .subscriptions: id => Billing::Gateway::Subscription you want retrieve_subscription to return
#   - .later_states: id => states that replace .subscriptions[id] one per retrieve (after that call returns)
#   - .customers_created, .checkout_sessions, .canceled: what the code under test asked for
#   - VALID_SIGNATURE: the only signature construct_event accepts
#   - .event_payload: a webhook JSON body for a given event type and subscription id
class FakeStripeGateway
  VALID_SIGNATURE = "fake-valid-signature"

  class << self
    attr_accessor :configured, :checkout_configured, :checkout_error, :portal_error, :cancel_error
    attr_reader :subscriptions, :later_states, :customers_created, :checkout_sessions, :portal_sessions, :canceled

    def reset!
      @configured = true
      @checkout_configured = true
      @checkout_error = nil
      @portal_error = nil
      @cancel_error = nil
      @subscriptions = {}
      @later_states = {}
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
  def checkout_configured? = configured? && self.class.checkout_configured

  def create_customer(user)
    self.class.customers_created << user.id
    "cus_fake_#{self.class.customers_created.size}"
  end

  def create_checkout_session(customer_id:, user_id:, success_url:, cancel_url:)
    raise self.class.checkout_error if self.class.checkout_error
    self.class.checkout_sessions << { customer_id: customer_id, user_id: user_id, success_url: success_url, cancel_url: cancel_url }
    "https://checkout.stripe.test/session/#{self.class.checkout_sessions.size}"
  end

  def create_portal_session(customer_id:, return_url:)
    raise self.class.portal_error if self.class.portal_error
    self.class.portal_sessions << { customer_id: customer_id, return_url: return_url }
    "https://billing.stripe.test/portal/#{self.class.portal_sessions.size}"
  end

  # Each call returns the current state; any queued later states are then moved in, so a second fetch can differ.
  def retrieve_subscription(subscription_id)
    current = self.class.subscriptions.fetch(subscription_id)
    following = self.class.later_states[subscription_id]&.shift
    self.class.subscriptions[subscription_id] = following if following
    current
  end

  def cancel_subscription_now(subscription_id)
    raise self.class.cancel_error if self.class.cancel_error
    self.class.canceled << subscription_id
    nil
  end

  # Cancels every not-yet-ended subscription of the customer, like the real adapter.
  def cancel_customer_subscriptions(customer_id)
    raise self.class.cancel_error if self.class.cancel_error
    self.class.subscriptions.each_value do |subscription|
      next unless subscription.customer_id == customer_id && !Billing::Gateway::ENDED_STATUSES.include?(subscription.status)
      self.class.canceled << subscription.id
      self.class.subscriptions[subscription.id] = subscription.with(status: "canceled")
    end
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

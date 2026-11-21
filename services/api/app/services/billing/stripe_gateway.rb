# The real Stripe adapter behind Billing::Gateway. The only file that uses the stripe gem.
#
# Needs STRIPE_SECRET_KEY, STRIPE_PRICE_ID (checkout) and STRIPE_WEBHOOK_SECRET (webhooks).
# `configured?` says whether checkout can run. Every call goes to Stripe over the network.
# Index:
#   - API_VERSION: the one place the Stripe API version is pinned (the version the gem was built for)
#   - create_customer, create_checkout_session, create_portal_session
#   - retrieve_subscription, cancel_subscription_now
#   - construct_event: verifies the webhook signature and returns a Gateway::Event (or nil for ignored types)
#   - subscription_from, event_from: turn Stripe objects into the plain Gateway values
module Billing
  class StripeGateway
    API_VERSION = "2026-11-18.endive"
    WEBHOOK_EVENT_TYPES = %w[
      checkout.session.completed customer.subscription.created
      customer.subscription.updated customer.subscription.deleted
    ].freeze

    # Reads a Stripe subscription into plain values. In recent API versions the period end lives
    # on the subscription items, so use it from the first item when the top-level field is absent.
    def self.subscription_from(stripe_subscription)
      data = stripe_subscription.to_hash
      period_end = data[:current_period_end] || Array(data.dig(:items, :data)).filter_map { |item| item[:current_period_end] }.max
      customer = data[:customer]
      Gateway::Subscription.new(
        id: data[:id], customer_id: customer.is_a?(Hash) ? customer[:id] : customer, status: data[:status],
        current_period_end: period_end && Time.zone.at(period_end),
        cancel_at_period_end: data[:cancel_at_period_end] ? true : false,
        user_id: (data[:metadata] || {})[:user_id]
      )
    end

    # Reduces a verified Stripe event to its type and subscription id. Types we don't use give nil.
    def self.event_from(stripe_event)
      return unless WEBHOOK_EVENT_TYPES.include?(stripe_event.type)
      object = stripe_event.data.object
      subscription_id = stripe_event.type == "checkout.session.completed" ? object["subscription"] : object["id"]
      Gateway::Event.new(type: stripe_event.type, subscription_id: subscription_id)
    end

    def configured?
      ENV["STRIPE_SECRET_KEY"].present? && ENV["STRIPE_PRICE_ID"].present?
    end

    # The idempotency key means a retry after a crash reuses the customer Stripe already made.
    def create_customer(user)
      client.v1.customers.create({ email: user.email, metadata: { user_id: user.id } },
        { idempotency_key: "careerdrafter-customer-#{user.id}" }).id
    end

    def create_checkout_session(customer_id:, user_id:, success_url:, cancel_url:)
      client.v1.checkout.sessions.create(
        mode: "subscription",
        customer: customer_id,
        line_items: [ { price: ENV.fetch("STRIPE_PRICE_ID"), quantity: 1 } ],
        client_reference_id: user_id,
        subscription_data: { metadata: { user_id: user_id } },
        automatic_tax: { enabled: true },
        customer_update: { address: "auto" },
        success_url: success_url,
        cancel_url: cancel_url
      ).url
    end

    def create_portal_session(customer_id:, return_url:)
      client.v1.billing_portal.sessions.create(customer: customer_id, return_url: return_url).url
    end

    def retrieve_subscription(subscription_id)
      self.class.subscription_from(client.v1.subscriptions.retrieve(subscription_id))
    end

    def cancel_subscription_now(subscription_id)
      client.v1.subscriptions.cancel(subscription_id)
      nil
    end

    # Raises Gateway::InvalidSignature for a missing or wrong signature or an unreadable body.
    def construct_event(payload, signature_header)
      secret = ENV["STRIPE_WEBHOOK_SECRET"]
      raise Gateway::InvalidSignature, "missing signature" if signature_header.blank? || secret.blank?
      self.class.event_from(Stripe::Webhook.construct_event(payload, signature_header, secret))
    rescue Stripe::SignatureVerificationError, JSON::ParserError => error
      raise Gateway::InvalidSignature, error.message
    end

    private

    def client
      Stripe::StripeClient.new(ENV.fetch("STRIPE_SECRET_KEY"), stripe_version: API_VERSION)
    end
  end
end

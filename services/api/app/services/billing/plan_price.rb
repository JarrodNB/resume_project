# The plan price as people should see it ("$12/month"), read from the Stripe price Checkout charges.
#
# Reading it from Stripe means changing STRIPE_PRICE_ID changes what the billing page shows. The
# label is cached for an hour so the page does not call Stripe on every load. It is nil when no
# price is configured or Stripe can't be reached; a nil is not cached, so the next load tries again.
# Index:
#   - label: the display text, or nil
#   - format: turns a Gateway::Price into its display text
module Billing
  module PlanPrice
    CACHE_TTL = 1.hour

    def self.label(gateway: Gateway.current)
      return unless gateway.checkout_configured?

      Rails.cache.fetch("billing/plan_price/#{ENV["STRIPE_PRICE_ID"]}", expires_in: CACHE_TTL, skip_nil: true) do
        format(gateway.retrieve_price)
      end
    rescue Gateway::Unavailable, Gateway::NotFound => error
      Rails.logger.warn("Could not read the Stripe plan price: #{error.class}")
      nil
    end

    def self.format(price)
      return if price.unit_amount.nil?

      amount = price.unit_amount / 100.0
      amount_text = (amount % 1).zero? ? amount.to_i.to_s : Kernel.format("%.2f", amount)
      money = price.currency == "usd" ? "$#{amount_text}" : "#{amount_text} #{price.currency.upcase}"
      price.interval ? "#{money}/#{price.interval}" : money
    end
  end
end

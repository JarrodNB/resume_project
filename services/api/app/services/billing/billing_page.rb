# Two small things the billing screens share: the link to the web app's billing page and the
# plain "billing is unavailable" message.
#
# `url` is used for the checkout return links, the portal return link and the trial-ending email,
# so they all agree on WEB_APP_URL (a trailing slash on it is fine). `UNAVAILABLE` is what users
# see when Stripe isn't set up or can't be reached.
module Billing
  module BillingPage
    UNAVAILABLE = "Billing isn't available right now."

    # @param query [Hash, nil] optional query parameters, e.g. `checkout: "success"`
    def self.url(query = nil)
      base = "#{ENV.fetch('WEB_APP_URL', 'http://localhost:5173').delete_suffix('/')}/account/billing"
      query ? "#{base}?#{query.to_query}" : base
    end
  end
end

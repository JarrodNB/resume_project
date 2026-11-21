# frozen_string_literal: true

# Description: Starts Stripe Checkout for the signed-in user and returns the page to send them to.
module Mutations
  module Billing
    class StartCheckout < Mutations::BaseMutation
      field :url, String, description: "The Stripe Checkout page. Null when there are errors."

      # Calls Billing::StartCheckoutService.
      def resolve
        payload_from(::Billing::StartCheckoutService.call(user: current_user), :url)
      end
    end
  end
end

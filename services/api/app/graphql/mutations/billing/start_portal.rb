# frozen_string_literal: true

# Description: Opens the Stripe Customer Portal for the signed-in user and returns the page to send them to.
module Mutations
  module Billing
    class StartPortal < Mutations::BaseMutation
      field :url, String, description: "The Stripe Customer Portal page. Null when there are errors."

      # Calls Billing::StartPortalService.
      def resolve
        payload_from(::Billing::StartPortalService.call(user: current_user), :url)
      end
    end
  end
end

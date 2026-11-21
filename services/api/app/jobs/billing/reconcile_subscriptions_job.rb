# Daily job that re-checks every billing row against Stripe; see Billing::ReconcileSubscriptionsService.
module Billing
  class ReconcileSubscriptionsJob < ApplicationJob
    queue_as :maintenance

    def perform
      ReconcileSubscriptionsService.call
    end
  end
end

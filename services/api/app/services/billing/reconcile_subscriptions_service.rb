# Daily safety net that re-checks every billing row against Stripe, in case a webhook sync was lost.
#
# A webhook sync gives up after about two days of retries, and Stripe never resends an event we
# already answered. So once a day this asks Stripe for each customer's subscriptions that have not
# ended, adds the one our row records, and queues the usual Billing::SyncSubscriptionJob for each.
# The sync does the real work (and its guards), so running this twice is harmless. One Stripe call
# per customer; a customer Stripe can't answer for is logged and checked again tomorrow.
module Billing
  class ReconcileSubscriptionsService < ApplicationService
    def initialize(gateway: Gateway.current)
      @gateway = gateway
    end

    # @return [ServiceResult] success with the number of syncs queued
    def call
      return success(0) unless @gateway.configured?

      queued = 0
      BillingSubscription.find_each do |row|
        subscription_ids_for(row).each do |subscription_id|
          SyncSubscriptionJob.perform_later(subscription_id)
          queued += 1
        end
      end
      success(queued)
    end

    private

    def subscription_ids_for(row)
      ids = @gateway.live_subscription_ids(row.stripe_customer_id)
      recorded = row.stripe_subscription_id
      ids |= [ recorded ] if recorded.present? && !Gateway::ENDED_STATUSES.include?(row.status)
      ids
    rescue Gateway::NotFound
      Rails.logger.warn("Stripe has no customer #{row.stripe_customer_id} for billing row #{row.id}; skipping reconciliation")
      []
    rescue Gateway::Unavailable => error
      Rails.logger.warn("Stripe reconciliation failed for billing row #{row.id}: #{error.class}; trying again tomorrow")
      []
    end
  end
end

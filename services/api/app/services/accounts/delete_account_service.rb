# Permanently deletes a signed-in user's account and everything it owns after they confirm
# their current password. If they have a live Stripe subscription it is cancelled first (right away,
# no refund), and if Stripe can't do that the account is kept so they are never billed for nothing.
# Model callbacks do the cleanup: interview audio is handed to
# Interviews::CleanupJob for storage deletion, and uploaded resume files are purged in the
# background. The caller signs the browser out; other browsers lose access because their
# sessions no longer resolve to a user.
module Accounts
  class DeleteAccountService < ApplicationService
    CANCEL_FAILED = "We couldn't cancel your subscription, so your account wasn't deleted. Try again in a moment."
    ENDED_STATUSES = %w[canceled incomplete_expired].freeze

    def initialize(user:, current_password:, gateway: Billing::Gateway.current)
      @user, @current_password, @gateway = user, current_password, gateway
    end

    # Safe to repeat: a second request finds no account and the caller treats it as signed out.
    # @return [ServiceResult] failure with a message when the password is wrong or deletion fails
    def call
      return failure([ "Current password is incorrect" ]) unless @user.valid_password?(@current_password)
      return failure([ CANCEL_FAILED ]) unless cancel_live_subscription

      @user.with_lock do
        return failure([ "Current password is incorrect" ]) unless @user.valid_password?(@current_password)

        @user.destroy!
      end
      success
    rescue ActiveRecord::RecordNotDestroyed, ActiveRecord::InvalidForeignKey => error
      Rails.logger.warn("Could not delete account #{@user.id}: #{error.class}")
      failure([ "We couldn't delete your account. Try again in a moment." ])
    end

    private

    # True when there is nothing live to cancel or Stripe cancelled it. This runs before the user row
    # is locked so the lock is not held during the network call. A subscription Stripe no longer has counts as cancelled.
    def cancel_live_subscription
      row = @user.billing_subscription
      return true if row&.stripe_subscription_id.blank? || row.status.in?(ENDED_STATUSES)
      return false unless @gateway.configured?

      @gateway.cancel_subscription_now(row.stripe_subscription_id)
      true
    rescue Stripe::InvalidRequestError => error
      return true if error.code == "resource_missing"
      Rails.logger.error("Stripe cancel failed for user #{@user.id}: #{error.class}")
      false
    rescue Stripe::StripeError => error
      Rails.logger.error("Stripe cancel failed for user #{@user.id}: #{error.class}")
      false
    end
  end
end

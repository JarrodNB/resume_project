# Requests Devise recovery mail without revealing whether a confirmed account exists.
module Accounts
  class RequestPasswordResetService < ApplicationService
    MESSAGE = "If this address belongs to a verified account, a password reset email will arrive shortly. Check spam, or try again."

    def initialize(email:)
      @email = email
    end

    # Serializes resends with password changes; Devise generates and stores its token digest.
    def call
      user = User.find_by(email: @email.strip.downcase)
      return success unless user
      user.with_lock { user.send_reset_password_instructions if user.confirmed? }
      success
    rescue ActiveJob::EnqueueError
      Rails.logger.warn("Account email enqueue failed")
      success
    end
  end
end

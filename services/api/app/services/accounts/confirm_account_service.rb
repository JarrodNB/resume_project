# Serializes confirmation and resend; Devise owns tokens, expiry and account state.
module Accounts
  class ConfirmAccountService < ApplicationService
    INVALID = [ "This verification link is invalid or expired. Request a new email." ].freeze

    def initialize(email: nil, token: nil)
      @email, @token = email, token
    end

    # Resends without revealing existence, or consumes a valid token exactly once.
    def call
      return resend if @email
      return failure(INVALID) unless @token.is_a?(String) && @token.match?(/\A[A-Za-z0-9_-]{20,128}\z/)
      user = User.find_by(confirmation_token: @token)
      return failure(INVALID) unless user
      user.with_lock do
        return failure(INVALID) unless user.confirmation_token == @token && !user.confirmed?
        return failure(INVALID) unless user.confirm
        success
      end
    end

    private

    def resend
      user = User.find_by(email: @email.strip.downcase)
      return success unless user
      user.with_lock do
        return success if user.confirmed?
        # Devise otherwise reuses unexpired tokens. Force its standard generator.
        user.update_columns(confirmation_token: nil)
        user.reload.send_confirmation_instructions
      end
      success
    rescue ActiveJob::EnqueueError
      Rails.logger.warn("Account email enqueue failed")
      success
    end
  end
end

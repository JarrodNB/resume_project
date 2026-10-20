# Consumes a Devise recovery token under a row lock, so it can succeed only once.
module Accounts
  class ResetPasswordService < ApplicationService
    INVALID = [ "This reset link is invalid or expired. Request a new email." ].freeze

    def initialize(token:, password:, password_confirmation:)
      @token, @password, @confirmation = token, password, password_confirmation
    end

    # Failed validation leaves persisted credentials and token unchanged. Changing the
    # bcrypt salt invalidates every Devise session, including captured cookies and Cable.
    def call
      return failure(INVALID) unless @token.is_a?(String) && @token.match?(/\A[A-Za-z0-9_-]{20,128}\z/)
      user = User.with_reset_password_token(@token)
      return failure(INVALID) unless user
      user.with_lock do
        digest = Devise.token_generator.digest(User, :reset_password_token, @token)
        return failure(INVALID) unless user.reset_password_token == digest && user.reset_password_period_valid? && user.confirmed?
        return failure([ "Password confirmation must match" ]) unless @password.is_a?(String) && @confirmation.is_a?(String) && @password == @confirmation
        user.reset_password(@password, @confirmation) ? success(user) : failure(user.errors)
      end
    end
  end
end

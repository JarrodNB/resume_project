# Checks current credentials and changes only the authorized user's password atomically.
module Accounts
  class ChangePasswordService < ApplicationService
    def initialize(user:, current_password:, password:, password_confirmation:)
      @user, @current, @password, @confirmation = user, current_password, password, password_confirmation
    end

    # Reload under the same lock used by reset, preventing stale credentials from winning a race.
    # Devise validates the current password and clears outstanding recovery tokens on success.
    def call
      @user.with_lock do
        return failure([ "Password confirmation must match" ]) unless @password.is_a?(String) && @confirmation.is_a?(String) && @password == @confirmation
        return failure([ "Password cannot be blank" ]) if @password.blank?
        @user.update_with_password(current_password: @current, password: @password, password_confirmation: @confirmation) ? success : failure(@user.errors)
      end
    end
  end
end

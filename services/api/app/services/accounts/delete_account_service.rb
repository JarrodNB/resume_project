# Permanently deletes a signed-in user's account and everything it owns after they confirm
# their current password. Model callbacks do the cleanup: interview audio is handed to
# Interviews::CleanupJob for storage deletion, and uploaded resume files are purged in the
# background. The caller signs the browser out; other browsers lose access because their
# sessions no longer resolve to a user.
module Accounts
  class DeleteAccountService < ApplicationService
    def initialize(user:, current_password:)
      @user, @current_password = user, current_password
    end

    # Safe to repeat: a second request finds no account and the caller treats it as signed out.
    # @return [ServiceResult] failure with a message when the password is wrong or deletion fails
    def call
      @user.with_lock do
        return failure([ "Current password is incorrect" ]) unless @user.valid_password?(@current_password)

        @user.destroy!
      end
      success
    rescue ActiveRecord::RecordNotDestroyed, ActiveRecord::InvalidForeignKey => error
      Rails.logger.warn("Could not delete account #{@user.id}: #{error.class}")
      failure([ "We couldn't delete your account. Try again in a moment." ])
    end
  end
end

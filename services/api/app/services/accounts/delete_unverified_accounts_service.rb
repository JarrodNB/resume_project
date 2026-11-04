# Deletes accounts nobody verified within a week, freeing the email address for its real owner.
# Accounts present before email verification existed were marked verified, and unverified
# accounts can't sign in, so these hold no user work. A recent resend restarts the week.
module Accounts
  class DeleteUnverifiedAccountsService < ApplicationService
    RETENTION = 7.days
    BATCH_SIZE = 500

    # Safe to run twice. Each row is rechecked under a lock in case it was verified just now.
    # @return [ServiceResult] value is how many rows this batch examined; a full batch means run again.
    def call
      batch = stale_accounts.limit(BATCH_SIZE).to_a
      batch.each do |user|
        user.with_lock { user.destroy! if stale_accounts.exists?(user.id) }
      rescue ActiveRecord::RecordNotDestroyed, ActiveRecord::InvalidForeignKey => error
        Rails.logger.warn("Could not delete unverified account #{user.id}: #{error.class}")
      end
      success(batch.size)
    end

    private

    def stale_accounts
      cutoff = RETENTION.ago
      User.where(confirmed_at: nil).where(created_at: ...cutoff)
        .where("confirmation_sent_at IS NULL OR confirmation_sent_at < ?", cutoff)
    end
  end
end

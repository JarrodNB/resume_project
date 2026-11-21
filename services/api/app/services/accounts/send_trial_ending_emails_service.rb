# Emails users whose free trial is about to end, at most once each.
# The daily job looks 36 hours ahead (not 24) so a trial can never fall between two runs;
# the email names the end date (UTC), and a user is emailed only once however many runs see them.
# Paid users never get it. An operator spend-cap override does not change that.
module Accounts
  class SendTrialEndingEmailsService < ApplicationService
    WINDOW = 36.hours
    BATCH_SIZE = 500

    # Safe to run twice or at the same time: each user is claimed with a conditional update
    # before their email is queued, so only one run can win.
    # @return [ServiceResult] value is how many users this batch examined; a full batch means run again.
    def call
      batch = candidates.limit(BATCH_SIZE).to_a
      batch.each do |user|
        next unless claim(user)

        deliver(user)
      end
      success(batch.size)
    end

    private

    def candidates
      now = Time.current
      User.where.not(confirmed_at: nil)
        .where(trial_ends_at: now..(now + WINDOW))
        .where(trial_ending_email_sent_at: nil)
        .where.not(id: BillingSubscription.paid.select(:user_id))
        .order(:trial_ends_at)
    end

    def claim(user)
      User.where(id: user.id, trial_ending_email_sent_at: nil)
        .update_all(trial_ending_email_sent_at: Time.current) == 1
    end

    # If the email cannot be queued, give the claim back so the next run tries again.
    def deliver(user)
      AccountMailer.trial_ending(user).deliver_later
    rescue StandardError
      User.where(id: user.id).update_all(trial_ending_email_sent_at: nil)
      raise
    end
  end
end

# The one place that knows how long the free trial is and when a user's trial ends.
#
# A trial starts when the user confirms their email (Accounts::ConfirmAccountService calls
# `start!`). Billing::ResolvePlanService reads the end date with `ends_at_for`, which also covers
# a confirmed user whose stored date is missing (confirmed before trial dates existed).
# Index:
#   - LENGTH: how long a trial lasts
#   - start!: stores the trial end for a user who confirmed at the given time
#   - ends_at_for: the trial end for a user, or nil if the trial never started
module Billing
  module Trial
    LENGTH = 7.days

    # Stores the end of the trial, one LENGTH after `at`. Skips model callbacks and validations.
    def self.start!(user, at:)
      user.update_columns(trial_ends_at: at + LENGTH)
    end

    # Returns the stored trial end, else one LENGTH after confirmation, else nil (never confirmed).
    def self.ends_at_for(user)
      user.trial_ends_at || (user.confirmed_at && user.confirmed_at + LENGTH)
    end
  end
end

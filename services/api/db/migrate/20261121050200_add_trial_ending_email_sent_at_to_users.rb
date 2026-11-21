# Remembers when we emailed a user that their free trial is ending, so we only ever send it once.
class AddTrialEndingEmailSentAtToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :trial_ending_email_sent_at, :datetime
  end
end

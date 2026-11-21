# Daily job that emails users whose free trial is about to end.
# Runs once a day and looks 36 hours ahead (see the service), so no trial is missed between runs.
module Accounts
  class SendTrialEndingEmailsJob < ApplicationJob
    queue_as :maintenance

    def perform
      result = SendTrialEndingEmailsService.call
      self.class.perform_later if result.value == SendTrialEndingEmailsService::BATCH_SIZE
    end
  end
end

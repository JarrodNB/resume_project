# Daily job that emails users whose free trial is about to end.
# Runs daily and looks 36 hours ahead. Temporary mail enqueue failures retry after a few minutes
# so the remaining reminders do not have to wait until tomorrow.
module Accounts
  class SendTrialEndingEmailsJob < ApplicationJob
    queue_as :maintenance

    retry_on ActiveJob::EnqueueError, wait: 5.minutes, attempts: 12

    def perform
      result = SendTrialEndingEmailsService.call
      self.class.perform_later if result.value == SendTrialEndingEmailsService::BATCH_SIZE
    end
  end
end

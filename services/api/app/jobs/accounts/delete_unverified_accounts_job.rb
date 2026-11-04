# Hourly cleanup of accounts that were never verified. Catches up in further batches when needed.
module Accounts
  class DeleteUnverifiedAccountsJob < ApplicationJob
    queue_as :maintenance

    def perform
      result = DeleteUnverifiedAccountsService.call
      self.class.perform_later if result.value == DeleteUnverifiedAccountsService::BATCH_SIZE
    end
  end
end

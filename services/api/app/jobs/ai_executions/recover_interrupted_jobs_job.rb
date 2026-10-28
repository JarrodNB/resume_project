# Reconcile framework failure rows, never scan domain operations for runnable work.
module AiExecutions
  class RecoverInterruptedJobsJob < ApplicationJob
    queue_as :maintenance

    def perform
      RecoverInterruptedJobsService.call
    end
  end
end

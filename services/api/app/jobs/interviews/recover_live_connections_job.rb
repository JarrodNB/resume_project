# Ends live interview rooms whose agent went quiet, about once a minute (config/recurring.yml).
# See Interviews::RecoverLiveConnectionsService; safe to run twice or alongside a late agent call.
module Interviews
  class RecoverLiveConnectionsJob < AiExecutions::DurableJob
    queue_as :maintenance

    def perform
      RecoverLiveConnectionsService.call
    end

    def stop_delivery
      Rails.logger.warn("Live connection recovery deferred until the next scheduled run")
    end
  end
end

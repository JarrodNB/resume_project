# Retire expired interview work/content and retry private-object deletion in Rails.
# The next scheduled maintenance run remains available after an exhausted queue job.
module Interviews
  class CleanupJob < AiExecutions::DurableJob
    queue_as :maintenance

    def perform
      CleanupService.call
    end

    def stop_delivery
      Rails.logger.warn("Interview cleanup deferred until scheduled maintenance")
    end
  end
end

# Retire observer credentials without depending on an active streaming service.
module AiExecutions
  class PruneStreamGrantsJob < ApplicationJob
    queue_as :ai_maintenance

    def perform
      result = PruneStreamGrantsService.call
      self.class.perform_later if result.value == 500
    end
  end
end

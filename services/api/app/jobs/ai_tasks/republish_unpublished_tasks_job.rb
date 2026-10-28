# Sends saved-but-unpublished AI tasks to SQS again, once a minute from the recurring schedule.
module AiTasks
  class RepublishUnpublishedTasksJob < ApplicationJob
    queue_as :maintenance

    def perform
      RepublishUnpublishedTasksService.call
    end
  end
end

# Daily cleanup of old uploaded resume files. Catches up in further batches when needed.
module ResumeImports
  class PurgeOldUploadsJob < ApplicationJob
    queue_as :maintenance

    def perform
      result = PurgeOldUploadsService.call
      self.class.perform_later if result.value == PurgeOldUploadsService::BATCH_SIZE
    end
  end
end

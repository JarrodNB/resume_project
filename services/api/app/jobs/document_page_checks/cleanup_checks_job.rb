# Gives interrupted checks and private-object cleanup a recurring recovery path.
module DocumentPageChecks
  class CleanupChecksJob < ApplicationJob
    def perform
      CleanupChecksService.call
    end
  end
end

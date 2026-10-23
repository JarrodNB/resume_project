# Runs an already-authorized private document check outside the request.
module DocumentPageChecks
  class CountPagesJob < ApplicationJob
    self.enqueue_after_transaction_commit = true
    def perform(id)
      check = ResumeDocxPageCheck.find_by(id: id)
      CountPagesService.call(check: check) if check
    end
  end
end

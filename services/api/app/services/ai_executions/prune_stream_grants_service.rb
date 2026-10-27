# Delete a bounded batch of expired observer grants; live execution is untouched.
module AiExecutions
  class PruneStreamGrantsService < ApplicationService
    def call
      count = AiExecutionStreamGrant.where("expires_at <= ?", Time.current)
        .order(:expires_at, :id).limit(500).delete_all
      success(count)
    end
  end
end

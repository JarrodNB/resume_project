# Saves a manually entered job for its owner. An unstated company is stored as null;
# imported jobs use the corresponding posting service.
module Jobs
  class CreateJobService < ApplicationService
    def initialize(user:, attributes:)
      @user = user
      @attributes = attributes
    end

    # Saves the job.
    def call
      attributes = @attributes.to_h.symbolize_keys
      attributes[:company] = attributes[:company].presence
      job = @user.jobs.new(attributes)
      job.save ? success(job) : failure(job.errors)
    end
  end
end

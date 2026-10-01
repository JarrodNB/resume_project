# Description: Creates a job profile for a user (manual entry; scraping comes later via AI).
# Index:
#   - call: saves the job; returns it, or validation errors
module Jobs
  class CreateJobService < ApplicationService
    def initialize(user:, attributes:)
      @user = user
      @attributes = attributes
    end

    # Saves the job.
    def call
      job = @user.jobs.new(@attributes)
      job.save ? success(job) : failure(job.errors)
    end
  end
end

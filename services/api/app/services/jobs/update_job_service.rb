# Description: Updates a job's profile fields. Stage changes go through MoveJobToStageService.
# Index:
#   - call: applies the attributes; returns the job, or validation errors
module Jobs
  class UpdateJobService < ApplicationService
    def initialize(job:, attributes:)
      @job = job
      @attributes = attributes
    end

    # Applies the attributes.
    def call
      @job.update(@attributes) ? success(@job) : failure(@job.errors)
    end
  end
end

# Updates a job's profile, keeping a cleared company as null. Unsubmitted fields stay
# unchanged. Stage changes go through MoveJobToStageService.
module Jobs
  class UpdateJobService < ApplicationService
    def initialize(job:, attributes:)
      @job = job
      @attributes = attributes
    end

    # Applies the attributes.
    def call
      attributes = @attributes.to_h.symbolize_keys
      attributes[:company] = attributes[:company].presence if attributes.key?(:company)
      @job.update(attributes) ? success(@job) : failure(@job.errors)
    end
  end
end

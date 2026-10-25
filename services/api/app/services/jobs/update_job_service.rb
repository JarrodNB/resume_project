# Updates a job's profile, keeping a cleared company as null. Unsubmitted fields stay
# unchanged. Reloads under the row lock so edits invalidate only their own screening
# approvals atomically. Stage changes go through MoveJobToStageService.
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
      @job.with_lock do
        @job.assign_attributes(attributes)
        RecordScreeningService.discard_changed_fields(job: @job)
        raise ActiveRecord::Rollback unless @job.save
      end
      @job.errors.any? ? failure(@job.errors) : success(@job.reload)
    end
  end
end

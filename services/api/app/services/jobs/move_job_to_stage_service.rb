# Description: Moves a job to a new application stage, recording when it was first applied to.
# Index:
#   - call: updates the stage (and applied_at on first move past unapplied)
module Jobs
  class MoveJobToStageService < ApplicationService
    def initialize(job:, stage:)
      @job = job
      @stage = stage
    end

    # Updates the stage.
    def call
      @job.stage = @stage
      @job.applied_at ||= Time.current unless @job.unapplied?
      @job.save ? success(@job) : failure(@job.errors)
    end
  end
end

# Archives an owned job without deleting answers, resumes, interviews, or AI history.
module Jobs
  class ArchiveJobService < ApplicationService
    def initialize(job:)
      @job = job
    end

    # Repeated archive requests preserve the original archive time and application stage.
    # @return [ServiceResult] the retained job, or validation errors
    def call
      @job.with_lock do
        @job.archived_at ||= Time.current
        @job.save ? success(@job) : failure(@job.errors)
      end
    end
  end
end

# Recover only known idempotent AI jobs interrupted by framework process death.
# Persist the budget separately because Solid Queue manual retry resets AJ counters.
module AiExecutions
  class RecoverInterruptedJobsService < ApplicationService
    JOBS = %w[AiExecutions::DispatchJob AiExecutions::RecoveryJob Interviews::CleanupJob].freeze
    ERRORS = (%w[ProcessExitError ProcessPrunedError ProcessMissingError ThreadTerminatedError]
      .map { |name| "SolidQueue::Processes::#{name}" } + DurableJob::TRANSIENT_ERRORS.map(&:name)).freeze
    MAX_RECOVERIES = 3

    def initialize(job_ids: nil)
      @job_ids = job_ids
    end

    def call
      candidates = SolidQueue::FailedExecution.joins(:job)
        .where(solid_queue_jobs: { class_name: JOBS })
        .where("solid_queue_failed_executions.error::jsonb ->> 'exception_class' IN (?)", ERRORS)
      candidates = candidates.where(job_id: @job_ids) if @job_ids
      candidates.order(:id).limit(100).pluck(:id).each { |id| recover(id) }
      success
    end

    private

    def recover(id)
      failed = SolidQueue::FailedExecution.find_by(id: id)
      return unless failed

      failed.with_lock do
        job = failed.job
        receipt = AiJobRecovery.find_or_create_by!(active_job_id: job.active_job_id)
        receipt.with_lock do
          if receipt.recovery_count >= MAX_RECOVERIES
            unless receipt.exhausted_at
              receipt.update!(exhausted_at: Time.current, last_error: failed.exception_class)
              arguments = ActiveJob::Arguments.deserialize(job.arguments.fetch("arguments"))
              recovered = job.class_name.constantize.new(*arguments)
              recovered.job_id = job.active_job_id
              recovered.stop_delivery
            end
            next
          end
          receipt.update!(recovery_count: receipt.recovery_count + 1, last_error: failed.exception_class)
          failed.retry
        end
      end
    rescue ActiveRecord::RecordNotFound
      # Another reconciler already recovered this failed queue row.
      nil
    end
  end
end

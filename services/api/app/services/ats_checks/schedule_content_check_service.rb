# Record scheduling work in the save transaction. Delivery happens only after commit.
module AtsChecks
  class ScheduleContentCheckService < ApplicationService
    def initialize(resume:, force: false)
      @resume, @force = resume, force
    end

    # Reuses matching automatic/in-flight work; explicit retries replace terminal runs.
    def call
      @resume.with_lock(requires_new: true) do
        content = Snapshot.content(@resume)
        job = Snapshot.job(@resume)
        identity = { content_fingerprint: Snapshot.fingerprint(content),
                     job_fingerprint: Snapshot.fingerprint(job), rubric_version: Snapshot::RUBRIC_VERSION }
        latest = @resume.ats_check_runs.order(created_at: :desc, id: :desc).first
        if latest && identity.all? { |key, value| latest.public_send(key) == value } &&
            (!@force || %w[pending queued].include?(latest.status))
          enqueue_after_commit(latest) if @force && latest.status == "pending"
          return success(latest)
        end
        run = @resume.ats_check_runs.create!(**identity, user: @resume.user,
                                           content_snapshot: content, job_snapshot: job)
        enqueue_after_commit(run)
        success(run)
      end
    rescue ActiveRecord::ActiveRecordError => error
      Rails.logger.error("ATS snapshot scheduling failed: #{error.class}")
      failure([ "Could not schedule the resume check. Please retry." ])
    end

    private

    def enqueue_after_commit(run)
      ActiveRecord.after_all_transactions_commit do
        begin
          AtsChecks::DispatchContentCheckJob.perform_later(run.id)
        rescue StandardError => error
          Rails.logger.error("ATS scheduling remains pending for #{run.id}: #{error.class}")
          begin
            run.update_columns(error_message: "Could not schedule the check. Please retry.")
            NotifyReportService.call(resume: run.resume)
          rescue ActiveRecord::ActiveRecordError
            # The saved pending row can still be recovered by ats_checks:recover_pending.
          end
        end
      end
    end
  end
end

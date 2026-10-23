# Recovers missed queues, expires abandoned executions, and reaps private bytes in batches.
# Metadata lasts at most 23 hours plus one scheduler interval while storage is available.
module DocumentPageChecks
  class CleanupChecksService < ApplicationService
    BATCH_SIZE = 100
    def initialize(storage: PrivateStorage.new)
      @storage = storage
    end

    def call
      scope = ResumeDocxPageCheck.where("expires_at <= :now OR user_id IS NULL OR status IN ('queued','running') OR storage_key IS NOT NULL", now: Time.current)
      scope.order(Arel.sql("last_cleanup_at ASC NULLS FIRST"), :id).limit(BATCH_SIZE).each do |check|
        check.update_columns(last_cleanup_at: Time.current)
        check.with_lock do
          if check.user_id.nil? || check.expires_at <= Time.current ||
            (check.running? && check.lease_expires_at.to_i <= Time.current.to_i) ||
            (check.queued? && check.updated_at < 10.minutes.ago)
            check.update!(status: "failed", error_code: "expired", lease_expires_at: nil)
          end
        end
        if %w[completed failed].include?(check.status)
          PurgeUploadService.call(check: check, storage: @storage)
          check.destroy! if check.reload.storage_key.nil? && (check.user_id.nil? || check.expires_at <= Time.current)
        elsif check.queued? && check.upload_ready
          CountPagesJob.perform_later(check.id)
        end
      end
      success
    end
  end
end

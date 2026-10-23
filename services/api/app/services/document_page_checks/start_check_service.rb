# Binds an exact uploaded DOCX to its digest, persists cleanup ownership, then queues work.
# Upload and queue failures keep a durable private-object cleanup obligation.
require "digest"
require "tempfile"
module DocumentPageChecks
  class StartCheckService < ApplicationService
    MAX_BYTES = 5.megabytes
    def initialize(user:, file:, content_digest:, resume: nil, retry_failed: false, storage: PrivateStorage.new)
      @user, @file, @digest, @resume, @retry_failed, @storage = user, file, content_digest, resume, retry_failed, storage
    end

    def call
      bytes = @file.read(MAX_BYTES + 1)
      return failure("Choose a DOCX file up to 5 MB") if bytes.blank? || bytes.bytesize > MAX_BYTES
      return failure("Document digest does not match") unless /\A[0-9a-f]{64}\z/.match?(@digest) && Digest::SHA256.hexdigest(bytes) == @digest
      validation = Tempfile.create([ "docx-check", ".docx" ]) do |file|
        file.binmode; file.write(bytes); file.flush
        DocxPackageValidator.call(path: file.path)
      end
      return validation unless validation.success?

      check = nil
      needs_upload = false
      @user.with_lock do
        @user.class.connection.execute("SELECT pg_advisory_xact_lock(73821461)")
        check = @user.resume_docx_page_checks.find_by(content_digest: @digest)
        return success(check) if check && !(@retry_failed && check.failed?) && check.expires_at > Time.current
        return failure("Too many retries for this document") if @retry_failed && check && check.retry_count >= 2
        return failure("Please retry the check shortly") if check&.storage_key.present?
        return failure("Too many document checks; please retry later") if @user.resume_docx_page_checks.where(status: %w[queued running]).count >= 2 ||
          @user.resume_docx_page_checks.where("created_at > ?", 1.hour.ago).count >= 20
        return failure("Document checking is busy; please retry later") if ResumeDocxPageCheck.where(status: %w[queued running]).count >= 100
        check ||= @user.resume_docx_page_checks.build(content_digest: @digest)
        check.retry_count += 1 if check.persisted?
        check.assign_attributes(resume: @resume, status: "queued", expires_at: 23.hours.from_now,
          upload_ready: false, attempt_token: nil, lease_expires_at: nil, page_count: nil, error_code: nil)
        check.storage_key = "private/document-page-checks/#{check.id ||= SecureRandom.uuid}/#{SecureRandom.uuid}.docx"
        check.save!
        needs_upload = true
      end
      if needs_upload
        upload_key = check.storage_key
        @storage.write(key: upload_key, bytes: bytes)
        check.with_lock do
          if check.queued? && check.user_id == @user.id && check.expires_at > Time.current
            check.update!(upload_ready: true)
          else
            raise IOError, "Check expired during upload"
          end
        end
        CountPagesJob.perform_later(check.id)
      end
      success(check)
    rescue StandardError
      if check&.persisted?
        check.with_lock { check.update!(status: "failed", error_code: "unavailable") if check.queued? }
        PurgeUploadService.call(check: check, storage: @storage, key: upload_key) if upload_key
      end
      failure("DOCX page checking is unavailable; you can still download")
    ensure
      @file.rewind if @file.respond_to?(:rewind)
    end
  end
end

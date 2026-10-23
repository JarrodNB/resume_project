# Claims one bounded conversion, fences its result, and removes uploaded bytes promptly.
# Duplicate delivery cannot replace a terminal result or a newer execution attempt.
require "tempfile"
require "digest"
module DocumentPageChecks
  class CountPagesService < ApplicationService
    def initialize(check:, storage: PrivateStorage.new, counter: LibreOfficeCounter)
      @check, @storage, @counter = check, storage, counter
    end

    def call
      token = nil
      @check.class.transaction do
        @check.class.connection.execute("SELECT pg_advisory_xact_lock(73821461)")
        @check.lock!
        return success(@check) unless @check.queued? && @check.upload_ready && @check.user_id && @check.expires_at > Time.current
        return success(@check) if @check.class.where(status: "running").where("lease_expires_at > ?", Time.current).count >= 2
        token = SecureRandom.uuid
        @check.update!(status: "running", attempt_token: token, lease_expires_at: 2.minutes.from_now)
      end
      key = @check.storage_key
      bytes = @storage.read(key)
      raise IOError, "Changed document" unless Digest::SHA256.hexdigest(bytes) == @check.content_digest
      result = Tempfile.create([ "docx-count", ".docx" ]) do |file|
        file.binmode; file.write(bytes); file.flush
        @counter.call(path: file.path)
      end
      finish(token, result.success? ? { status: "completed", page_count: result.value, error_code: nil } : { status: "failed", error_code: "conversion_failed" })
      success(@check.reload)
    rescue StandardError
      finish(token, status: "failed", error_code: "unavailable") if token
      failure("DOCX page check failed")
    ensure
      PurgeUploadService.call(check: @check, storage: @storage, key: key) if token && key
    end

    private

    def finish(token, attributes)
      @check.with_lock do
        if @check.running? && @check.attempt_token == token
          @check.update!(attributes.merge(lease_expires_at: nil))
        end
      end
    end
  end
end

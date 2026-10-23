# Removes private bytes while preserving pending-write tombstones for delayed PUTs.
# A successful DELETE during an unfinished PUT is not proof that its bytes are gone.
module DocumentPageChecks
  class PurgeUploadService < ApplicationService
    def initialize(check:, storage: PrivateStorage.new, key: nil)
      @check, @storage, @key = check, storage, key
    end

    def call
      key = @key || @check.reload.storage_key
      return success unless key
      @storage.delete(key)
      begin
        record = @check.class.find_by(id: @check.id)
        return success unless record
        record.with_lock do
          pending_until = record.upload_expires_at && record.upload_expires_at + StartCheckService::DELAYED_WRITE_GRACE
          if record.storage_key == key && (!pending_until || pending_until <= Time.current)
            record.update!(storage_key: nil, upload_ready: false, upload_expires_at: nil)
          end
        end
      rescue ActiveRecord::RecordNotFound
        # The captured key was deleted above; missing metadata must not skip that DELETE.
      end
      success
    rescue StandardError
      failure("Private document cleanup will retry")
    end
  end
end

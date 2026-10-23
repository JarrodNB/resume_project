# Removes private bytes before forgetting their durable cleanup key.
module DocumentPageChecks
  class PurgeUploadService < ApplicationService
    def initialize(check:, storage: PrivateStorage.new, key: nil)
      @check, @storage, @key = check, storage, key
    end

    def call
      key = @key || @check.reload.storage_key
      return success unless key
      @storage.delete(key)
      @check.with_lock { @check.update!(storage_key: nil, upload_ready: false) if @check.storage_key == key }
      success
    rescue StandardError
      failure("Private document cleanup will retry")
    end
  end
end
